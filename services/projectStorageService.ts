import { ProjectData, ProjectMetadata, StorageBackend } from '../types';

// ============================================================================
// Storage Backend Detection
// ============================================================================

let detectedBackend: StorageBackend | null = null;

export const detectStorageCapability = (): StorageBackend => {
  if (detectedBackend) return detectedBackend;

  // Check File System Access API
  if ('showDirectoryPicker' in window) {
    detectedBackend = 'filesystem';
    return detectedBackend;
  }

  // Fallback to IndexedDB
  if ('indexedDB' in window) {
    detectedBackend = 'indexeddb';
    return detectedBackend;
  }

  detectedBackend = 'none';
  return detectedBackend;
};

// ============================================================================
// Helper Functions
// ============================================================================

const projectToMetadata = (project: ProjectData): ProjectMetadata => ({
  id: project.id,
  name: project.name,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  audioFileName: project.audioFileName,
  markerCount: project.markers.length,
  hasStoryboard: !!project.storyboard && project.storyboard.length > 0,
  hasVideo: false,
});

// ============================================================================
// IndexedDB Implementation
// ============================================================================

const DB_NAME = 'SonicCutAI_Projects';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
  });
};

const saveToIndexedDB = async (project: ProjectData): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(project);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const loadFromIndexedDB = async (projectId: string): Promise<ProjectData | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(projectId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
};

const listFromIndexedDB = async (): Promise<ProjectMetadata[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('updatedAt');
    const request = index.openCursor(null, 'prev'); // Sort by most recent

    const projects: ProjectMetadata[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const project = cursor.value as ProjectData;
        projects.push(projectToMetadata(project));
        cursor.continue();
      } else {
        resolve(projects);
      }
    };

    request.onerror = () => reject(request.error);
  });
};

const deleteFromIndexedDB = async (projectId: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(projectId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// ============================================================================
// File System Access API Implementation
// ============================================================================

let rootDirectoryHandle: FileSystemDirectoryHandle | null = null;

const getRootDirectory = async (): Promise<FileSystemDirectoryHandle> => {
  if (rootDirectoryHandle) return rootDirectoryHandle;

  try {
    // Request permission
    rootDirectoryHandle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents',
    });
    return rootDirectoryHandle;
  } catch (error) {
    throw new Error('User cancelled directory selection or permission denied');
  }
};

const saveToFileSystem = async (project: ProjectData): Promise<void> => {
  const root = await getRootDirectory();
  const projectDir = await root.getDirectoryHandle(project.id, { create: true });

  // Save metadata.json (exclude audioBlob using destructuring)
  const { audioBlob, ...metadata } = project;
  const metaFile = await projectDir.getFileHandle('metadata.json', { create: true });
  const metaWritable = await metaFile.createWritable();
  await metaWritable.write(JSON.stringify(metadata, null, 2));
  await metaWritable.close();

  // Save audio blob if present
  if (audioBlob) {
    const audioFile = await projectDir.getFileHandle('audio.blob', { create: true });
    const audioWritable = await audioFile.createWritable();
    await audioWritable.write(audioBlob);
    await audioWritable.close();
  }
};

const loadFromFileSystem = async (projectId: string): Promise<ProjectData | null> => {
  try {
    const root = await getRootDirectory();
    const projectDir = await root.getDirectoryHandle(projectId);

    // Load metadata
    const metaFile = await projectDir.getFileHandle('metadata.json');
    const metaBlob = await metaFile.getFile();
    const metaText = await metaBlob.text();
    const project = JSON.parse(metaText) as ProjectData;

    // Load audio blob if exists
    try {
      const audioFile = await projectDir.getFileHandle('audio.blob');
      const audioBlob = await audioFile.getFile();
      project.audioBlob = audioBlob;
    } catch {
      // Audio file might not exist yet
    }

    return project;
  } catch {
    return null;
  }
};

const listFromFileSystem = async (): Promise<ProjectMetadata[]> => {
  const root = await getRootDirectory();
  const projects: ProjectMetadata[] = [];

  for await (const entry of (root as any).values()) {
    if (entry.kind === 'directory') {
      try {
        const dir = entry as FileSystemDirectoryHandle;
        const metaFile = await dir.getFileHandle('metadata.json');
        const metaBlob = await metaFile.getFile();
        const metaText = await metaBlob.text();
        const project = JSON.parse(metaText) as ProjectData;

        projects.push(projectToMetadata(project));
      } catch (e) {
        console.warn(`Failed to load project metadata from ${entry.name}`, e);
      }
    }
  }

  // Sort by most recent
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
};

const deleteFromFileSystem = async (projectId: string): Promise<void> => {
  const root = await getRootDirectory();
  await root.removeEntry(projectId, { recursive: true });
};

// ============================================================================
// Public API (Backend Agnostic)
// ============================================================================

export const saveProject = async (project: ProjectData): Promise<void> => {
  const backend = detectStorageCapability();

  if (backend === 'filesystem') {
    try {
      return await saveToFileSystem(project);
    } catch (error) {
      // If File System fails, fall back to IndexedDB
      console.warn('File System save failed, falling back to IndexedDB', error);
      return await saveToIndexedDB(project);
    }
  } else if (backend === 'indexeddb') {
    return await saveToIndexedDB(project);
  } else {
    throw new Error('No storage backend available');
  }
};

export const loadProject = async (projectId: string): Promise<ProjectData | null> => {
  const backend = detectStorageCapability();

  if (backend === 'filesystem') {
    try {
      return await loadFromFileSystem(projectId);
    } catch (error) {
      // If File System fails, try IndexedDB
      console.warn('File System load failed, trying IndexedDB', error);
      return await loadFromIndexedDB(projectId);
    }
  } else if (backend === 'indexeddb') {
    return await loadFromIndexedDB(projectId);
  } else {
    return null;
  }
};

export const listProjects = async (): Promise<ProjectMetadata[]> => {
  const backend = detectStorageCapability();

  if (backend === 'filesystem') {
    try {
      return await listFromFileSystem();
    } catch (error) {
      // If File System fails, try IndexedDB
      console.warn('File System list failed, trying IndexedDB', error);
      return await listFromIndexedDB();
    }
  } else if (backend === 'indexeddb') {
    return await listFromIndexedDB();
  } else {
    return [];
  }
};

export const deleteProject = async (projectId: string): Promise<void> => {
  const backend = detectStorageCapability();

  if (backend === 'filesystem') {
    try {
      return await deleteFromFileSystem(projectId);
    } catch (error) {
      // If File System fails, try IndexedDB
      console.warn('File System delete failed, trying IndexedDB', error);
      return await deleteFromIndexedDB(projectId);
    }
  } else if (backend === 'indexeddb') {
    return await deleteFromIndexedDB(projectId);
  } else {
    throw new Error('No storage backend available');
  }
};

export const generateProjectName = async (audioFileName: string): Promise<string> => {
  const baseName = audioFileName.replace(/\.[^/.]+$/, ''); // Remove extension
  const existing = await listProjects();

  const names = existing.map(p => p.name);

  if (!names.includes(baseName)) {
    return baseName;
  }

  // Find next available number
  let counter = 2;
  while (names.includes(`${baseName} (${counter})`)) {
    counter++;
  }

  return `${baseName} (${counter})`;
};

export const renameProject = async (projectId: string, newName: string): Promise<void> => {
  const project = await loadProject(projectId);
  if (!project) throw new Error('Project not found');

  project.name = newName;
  project.updatedAt = Date.now();

  await saveProject(project);
};
