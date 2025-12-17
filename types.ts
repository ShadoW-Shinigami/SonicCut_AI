export interface Marker {
  id: string;
  time: number; // in seconds
  type: 'Cut' | 'Safety';
  strength: number; // 0 to 1 normalized onset strength
}

export interface AudioAnalysis {
  genre: string;
  theme: string;
  instruments: string[];
  bpm?: number;
  lyrics?: string;
}

export interface AudioState {
  file: File | null;
  buffer: AudioBuffer | null;
  duration: number;
  fileName: string;
  url: string;
}

export interface OnsetData {
  times: number[];
  values: number[]; // Normalized onset envelope
  detectedBpm?: number;
}

// Phase 2 Types

export type AspectRatio = '16:9' | '9:16' | '4:3' | '1:1' | '21:9';

export interface Character {
  id: string;
  name: string;
  description: string;
  imageUrl?: string; // Base64
}

export interface Location {
  id: string;
  name: string;
  description: string;
  imageUrl?: string; // Base64 single wide-angle reference
}

export interface SceneScript {
  id: string;
  markerId: string;
  startTime: number;
  description: string;
  interpolationPrompt: string; // Prompt to get from this scene to the next
  characterIds?: string[]; // List of IDs of characters present in this scene
  locationIds?: string[]; // List of IDs of locations in this scene
}

export interface StoryboardFrame extends SceneScript {
  imageUrl?: string; // Base64
  isGenerating: boolean;
  error?: string; // Generation error message
}

export interface VideoPlan {
  narrativeSummary: string;
  characters: Character[];
  locations: Location[];
  scenes: SceneScript[];
}

// Hierarchy Types (Phase 2 Enhancement)

export interface TransformationDelta {
  cameraOperation: string;     // "Dolly forward 2x"
  framingChange: string;        // "Character occupies 60% frame height"
  backgroundElements: string;   // "Maintain window in background"
  literalInstructions: string;  // Combined full instructions
}

export interface HierarchyNode {
  frameIndex: number;
  depth: number;                      // 0=parent, 1=child, 2=grandchild...
  parentIndex: number | null;
  childIndices: number[];
  transformationDelta: TransformationDelta | null;
  isReady: boolean;                   // True when parent available
  score?: number;                     // Anchor score for parents
}

export interface HierarchyTree {
  nodes: HierarchyNode[];             // Parallel array to storyboard
  parentIndices: number[];            // Quick parent lookup
  maxDepth: number;
}

export interface VideoPlanHierarchical extends VideoPlan {
  hierarchy: HierarchyTree;
  useHierarchy: boolean;
}

export interface StoryboardFrameHierarchical extends StoryboardFrame {
  hierarchyNode?: HierarchyNode;
  isBlocked?: boolean;                // Waiting for parent
}

// Phase 3 Types - Video Generation

export interface AspectRatioDimensions {
  width: number;
  height: number;
}

export interface VideoClip {
  id: string;
  frameId: string;
  shotIndex: number;
  generatedVideoUrl?: string;
  processedVideoBlob?: Blob;
  targetDuration: number;
  generatedDuration: 5 | 10;
  speedFactor: number;
  status: 'pending' | 'generating' | 'processing' | 'ready' | 'error';
  error?: string;
}

export interface VideoGenerationState {
  clips: VideoClip[];
  finalVideoUrl?: string;
  isGenerating: boolean;
  isProcessing: boolean;
  isStitching: boolean;
  progress: number;
  currentPhase: 'idle' | 'generating' | 'processing' | 'stitching' | 'complete';
}

// Project Management Types

export interface ProjectData {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;

  // Phase 1 Data
  audioFileName: string;
  audioDuration: number;
  audioBlob?: Blob;
  analysis: AudioAnalysis | null;
  markers: Marker[];
  onsetData: OnsetData | null;
  density: number;
  minDuration: number;
  maxDuration: number;
  customCount: string;
  useCustomCount: boolean;

  // Phase 2 Data
  aspectRatio?: AspectRatio;
  visualStyle?: string;
  videoPlan?: VideoPlan | null;
  storyboard?: StoryboardFrame[];
  hierarchyTree?: HierarchyTree | null;  // Optional hierarchy data

  // Phase 3 Data
  videoClips?: VideoClip[];
  finalVideoBlob?: Blob;
}

export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  audioFileName: string;
  markerCount: number;
  hasStoryboard: boolean;
  hasVideo: boolean;
}

export type StorageBackend = 'filesystem' | 'indexeddb' | 'none';