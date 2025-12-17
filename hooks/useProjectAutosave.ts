import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { saveProject, loadProject, generateProjectName, renameProject as renameProjectService } from '../services/projectStorageService';
import { AudioState, AudioAnalysis, Marker, OnsetData, AspectRatio, VideoPlan, StoryboardFrame, VideoClip, HierarchyTree } from '../types';

interface UseProjectAutosaveOptions {
  enabled: boolean;
  projectId: string | null;
  projectName: string;

  // Phase 1 State
  audioState: AudioState | null;
  analysis: AudioAnalysis | null;
  markers: Marker[];
  onsetData: OnsetData | null;
  density: number;
  minDuration: number;
  maxDuration: number;
  customCount: string;
  useCustomCount: boolean;

  // Phase 2 State
  aspectRatio?: AspectRatio;
  visualStyle?: string;
  videoPlan?: VideoPlan | null;
  storyboard?: StoryboardFrame[];
  hierarchyTree?: HierarchyTree | null;
  useHierarchy?: boolean;
  useConceptualMode?: boolean;

  // Phase 3 State
  videoClips?: VideoClip[];
  finalVideoBlob?: Blob | null;
}

interface UseProjectAutosaveReturn {
  isSaving: boolean;
  lastSaved: Date | null;
  saveNow: () => Promise<void>;
  renameProject: (newName: string) => Promise<void>;
}

const DEBOUNCE_MS = 500;

export const useProjectAutosave = (options: UseProjectAutosaveOptions): UseProjectAutosaveReturn => {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousStateRef = useRef<string>('');
  const isSavingRef = useRef(false);
  const optionsRef = useRef(options);

  // Update options ref on every render
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const saveNow = useCallback(async () => {
    const opts = optionsRef.current;
    if (!opts.enabled || !opts.projectId || !opts.audioState) {
      return;
    }

    // Prevent concurrent saves using ref to avoid stale closure
    if (isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);

    try {
      // Load existing project to preserve createdAt
      const existing = await loadProject(opts.projectId);

      await saveProject({
        id: opts.projectId,
        name: opts.projectName,
        createdAt: existing?.createdAt || Date.now(), // Preserve original
        updatedAt: Date.now(),

        audioFileName: opts.audioState.fileName,
        audioDuration: opts.audioState.duration,
        audioBlob: opts.audioState.file || undefined,

        analysis: opts.analysis,
        markers: opts.markers,
        onsetData: opts.onsetData,

        density: opts.density,
        minDuration: opts.minDuration,
        maxDuration: opts.maxDuration,
        customCount: opts.customCount,
        useCustomCount: opts.useCustomCount,

        aspectRatio: opts.aspectRatio,
        visualStyle: opts.visualStyle,
        narrativeMode: opts.useConceptualMode ? 'conceptual' : 'literal',
        videoPlan: opts.videoPlan,
        storyboard: opts.storyboard,
        hierarchyTree: opts.hierarchyTree,

        // Phase 3 Data
        videoClips: opts.videoClips,
        finalVideoBlob: opts.finalVideoBlob || undefined,
      });

      setLastSaved(new Date());
    } catch (error) {
      console.error('Failed to save project:', error);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, []); // Empty deps - uses optionsRef instead

  const renameProject = useCallback(async (newName: string) => {
    const opts = optionsRef.current;
    if (!opts.projectId) return;

    isSavingRef.current = true;
    setIsSaving(true);
    try {
      await renameProjectService(opts.projectId, newName);
      setLastSaved(new Date());
    } catch (error) {
      console.error('Failed to rename project:', error);
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, []); // Empty deps - uses optionsRef instead

  // Debounced autosave effect
  // Runs on every render but only saves when state actually changes
  useEffect(() => {
    if (!options.enabled || !options.projectId) return;

    // Serialize current state for comparison
    const currentState = JSON.stringify({
      markers: options.markers,
      density: options.density,
      minDuration: options.minDuration,
      maxDuration: options.maxDuration,
      customCount: options.customCount,
      useCustomCount: options.useCustomCount,
      aspectRatio: options.aspectRatio,
      visualStyle: options.visualStyle,
      useConceptualMode: options.useConceptualMode,
      videoPlanExists: !!options.videoPlan,
      storyboardCount: options.storyboard?.length || 0,
      videoClipsCount: options.videoClips?.length || 0,
      hasFinalVideo: !!options.finalVideoBlob,
    });

    // Skip if state hasn't changed
    if (currentState === previousStateRef.current) return;
    previousStateRef.current = currentState;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule debounced save
    saveTimeoutRef.current = setTimeout(() => {
      saveNow();
    }, DEBOUNCE_MS);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }); // No deps - runs every render, but has internal change detection

  return {
    isSaving,
    lastSaved,
    saveNow,
    renameProject,
  };
};
