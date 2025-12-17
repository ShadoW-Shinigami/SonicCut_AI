import React, { useState, useEffect, useRef } from 'react';
import { AudioAnalysis, AudioState, Marker, OnsetData, AspectRatio, VideoPlan, StoryboardFrame, VideoClip, HierarchyTree } from './types';
import { analyzeAudioCreatively } from './services/geminiService';
import { decodeAudio, computeOnsetEnvelope, generateMarkers, generateMarkersByCount } from './services/audioProcessingService';
import Waveform from './components/Waveform';
import FileUpload from './components/FileUpload';
import VideoPlanner from './components/VideoPlanner';
import ProjectSelector from './components/ProjectSelector';
import { useProjectAutosave } from './hooks/useProjectAutosave';
import { loadProject, generateProjectName } from './services/projectStorageService';
import { Music, Wand2, Download, Play, Pause, AlertCircle, Volume2, Mic2, Settings2, ChevronDown, ChevronUp, Activity, RefreshCw } from 'lucide-react';

const App: React.FC = () => {
  // Application State
  const [audioState, setAudioState] = useState<AudioState | null>(null);
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [onsetData, setOnsetData] = useState<OnsetData | null>(null);
  
  // UI State
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isRegeneratingAnalysis, setIsRegeneratingAnalysis] = useState(false);
  
  // Advanced Controls
  const [density, setDensity] = useState(0.5); 
  const [minDuration, setMinDuration] = useState(2.0);
  const [maxDuration, setMaxDuration] = useState(8.0);
  
  const [customCount, setCustomCount] = useState<string>("");
  const [useCustomCount, setUseCustomCount] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showLyrics, setShowLyrics] = useState(false);

  // Project Management State
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('Untitled Project');

  // Phase 2 State (lifted from VideoPlanner)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [visualStyle, setVisualStyle] = useState<string>("Cinematic, High Contrast, Neo-Noir");
  const [videoPlan, setVideoPlan] = useState<VideoPlan | null>(null);
  const [storyboard, setStoryboard] = useState<StoryboardFrame[]>([]);
  const [hierarchyTree, setHierarchyTree] = useState<HierarchyTree | null>(null);
  const [useHierarchy, setUseHierarchy] = useState<boolean>(false);
  const [useConceptualMode, setUseConceptualMode] = useState<boolean>(false);

  // Phase 3 State (lifted from VideoPlanner)
  const [videoClips, setVideoClips] = useState<VideoClip[]>([]);
  const [finalVideoBlob, setFinalVideoBlob] = useState<Blob | null>(null);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationRef = useRef<number | null>(null);

  // Autosave Hook
  const { isSaving, lastSaved, saveNow, renameProject: renameProjectHook } = useProjectAutosave({
    enabled: !!audioState,
    projectId: currentProjectId,
    projectName,
    audioState,
    analysis,
    markers,
    onsetData,
    density,
    minDuration,
    maxDuration,
    customCount,
    useCustomCount,
    hierarchyTree,
    useHierarchy,
    useConceptualMode,
    // Phase 2 state
    aspectRatio,
    visualStyle,
    videoPlan,
    storyboard,
    // Phase 3 state
    videoClips,
    finalVideoBlob,
  });

  // Handlers
  const handleFileSelect = async (file: File) => {
    setIsProcessing(true);
    setErrorMsg(null);

    // Reset ALL state for new project
    setAudioState(null);
    setAnalysis(null);
    setMarkers([]);
    setOnsetData(null);

    // Reset Phase 2 content (keep user's aspect ratio and style preferences)
    setVideoPlan(null);
    setStoryboard([]);

    // Reset Phase 3 state
    setVideoClips([]);
    setFinalVideoBlob(null);

    try {
      // Revoke old blob URL to prevent memory leak
      if (audioState?.url) {
        URL.revokeObjectURL(audioState.url);
      }

      const url = URL.createObjectURL(file);
      const buffer = await decodeAudio(file);

      // Generate project name and ID
      const newProjectName = await generateProjectName(file.name);
      const newProjectId = crypto.randomUUID();
      setCurrentProjectId(newProjectId);
      setProjectName(newProjectName);

      setAudioState({
        file,
        buffer,
        duration: buffer.duration,
        fileName: file.name,
        url
      });

      const data = computeOnsetEnvelope(buffer);
      setOnsetData(data);

      const initialMarkers = generateMarkers(data, {
          minDuration: 2.0,
          maxDuration: 8.0,
          sensitivity: 0.5
      }, buffer.duration);
      setMarkers(initialMarkers);

      analyzeAudioCreatively(file).then(setAnalysis).catch(err => {
        console.error("Gemini failed", err);
      });

    } catch (e) {
      console.error(e);
      setErrorMsg("Failed to process audio file. Please try another.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Regeneration Effect
  useEffect(() => {
    if (!onsetData || !audioState) return;

    let newMarkers: Marker[] = [];
    if (useCustomCount && customCount && !isNaN(parseInt(customCount))) {
        // Now passing min/max constraints to the count generator!
        newMarkers = generateMarkersByCount(
            onsetData, 
            parseInt(customCount), 
            audioState.duration,
            { minDuration, maxDuration }
        );
    } else {
        newMarkers = generateMarkers(onsetData, {
            minDuration,
            maxDuration,
            sensitivity: density
        }, audioState.duration);
    }
    setMarkers(newMarkers);
  }, [density, minDuration, maxDuration, useCustomCount, customCount, onsetData, audioState]);

  // Audio Sync
  useEffect(() => {
    if (isPlaying && audioRef.current) {
      const update = () => {
        if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
          animationRef.current = requestAnimationFrame(update);
        }
      };
      animationRef.current = requestAnimationFrame(update);
    } else {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    }
    return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleExport = () => {
    const csvContent = "data:text/csv;charset=utf-8,"
      + "Timestamp (Seconds),Type\n"
      + markers.map(m => `${m.time.toFixed(4)},${m.type}`).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${audioState?.fileName || "audio"}_markers.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRegenerateAnalysis = async () => {
    if (!audioState?.file) return;

    setIsRegeneratingAnalysis(true);
    try {
      const newAnalysis = await analyzeAudioCreatively(audioState.file);
      setAnalysis(newAnalysis);
    } catch (err) {
      console.error("Gemini regeneration failed", err);
      alert("Failed to regenerate analysis. Please try again.");
    } finally {
      setIsRegeneratingAnalysis(false);
    }
  };

  // Project Management Handlers
  const handleLoadProject = async (projectId: string) => {
    // Save current project before loading new one to prevent data loss
    if (currentProjectId && audioState) {
      await saveNow();
    }

    setIsProcessing(true);
    try {
      const project = await loadProject(projectId);
      if (!project) {
        setErrorMsg('Project not found');
        return;
      }

      setCurrentProjectId(project.id);
      setProjectName(project.name);

      // Restore Phase 1 state
      if (project.audioBlob) {
        // Revoke old blob URL to prevent memory leak
        if (audioState?.url) {
          URL.revokeObjectURL(audioState.url);
        }

        // Convert Blob to File for proper type compatibility
        const audioFile = new File([project.audioBlob], project.audioFileName, {
          type: project.audioBlob.type || 'audio/mpeg'
        });

        const url = URL.createObjectURL(audioFile);
        const buffer = await decodeAudio(audioFile);

        setAudioState({
          file: audioFile,
          buffer,
          duration: project.audioDuration,
          fileName: project.audioFileName,
          url,
        });
      }

      setAnalysis(project.analysis);
      setMarkers(project.markers);
      setOnsetData(project.onsetData);
      setDensity(project.density);
      setMinDuration(project.minDuration);
      setMaxDuration(project.maxDuration);
      setCustomCount(project.customCount);
      setUseCustomCount(project.useCustomCount);

      // Restore Phase 2 state
      // User preferences: only update if project has specific values
      if (project.aspectRatio !== undefined) setAspectRatio(project.aspectRatio);
      if (project.visualStyle !== undefined) setVisualStyle(project.visualStyle);
      // Project data: always reset to project's values (or empty)
      setVideoPlan(project.videoPlan || null);
      setStoryboard(project.storyboard || []);
      setHierarchyTree(project.hierarchyTree || null);
      setUseHierarchy(!!project.hierarchyTree); // Enable hierarchy if tree exists
      setUseConceptualMode(project.narrativeMode === 'conceptual'); // Restore narrative mode

      // Restore Phase 3 state: ALWAYS reset to project's values (or empty)
      setVideoClips(project.videoClips || []);
      setFinalVideoBlob(project.finalVideoBlob || null);

    } catch (error) {
      console.error('Failed to load project:', error);
      setErrorMsg('Failed to load project');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNewProject = async () => {
    // Save current project before resetting if it has Phase 2 data
    if (currentProjectId && audioState && (videoPlan || storyboard.length > 0)) {
      await saveNow();
    }

    // Revoke blob URL to prevent memory leak
    if (audioState?.url) {
      URL.revokeObjectURL(audioState.url);
    }

    // Reset Phase 1 state
    setAudioState(null);
    setAnalysis(null);
    setMarkers([]);
    setOnsetData(null);
    setCurrentProjectId(null);
    setProjectName('Untitled Project');
    setErrorMsg(null);

    // Reset Phase 2 state
    setAspectRatio('16:9');
    setVisualStyle("Cinematic, High Contrast, Neo-Noir");
    setVideoPlan(null);
    setStoryboard([]);

    // Reset Phase 3 state
    setVideoClips([]);
    setFinalVideoBlob(null);
  };

  const handleDeleteProject = () => {
    handleNewProject();
  };

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (audioState?.url) {
        URL.revokeObjectURL(audioState.url);
      }
    };
  }, [audioState?.url]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30 pb-20">
      
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Music className="w-8 h-8 text-indigo-500" />
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                SonicCut AI
              </h1>
            </div>

            <ProjectSelector
              projectName={projectName}
              isSaving={isSaving}
              lastSaved={lastSaved}
              onLoadProject={handleLoadProject}
              onNewProject={handleNewProject}
              onRenameProject={renameProjectHook}
              onDeleteProject={handleDeleteProject}
              hasActiveProject={!!audioState}
            />
          </div>

          {audioState && (
             <button onClick={handleExport} className="btn-secondary flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm font-medium transition-colors">
               <Download className="w-4 h-4" /> Export CSV
             </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {errorMsg && (
          <div className="mb-8 p-4 bg-red-900/20 border border-red-800 rounded-lg flex items-center gap-3 text-red-200">
            <AlertCircle className="w-5 h-5" /> <p>{errorMsg}</p>
          </div>
        )}

        {!audioState && (
          <div className="max-w-xl mx-auto mt-20">
            <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />
            <p className="text-center text-slate-500 mt-6 text-sm">Powered by Google Gemini 2.5 & Signal Processing</p>
          </div>
        )}

        {audioState && (
          <div className="space-y-8 animate-fade-in">
            
            {/* Analysis Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="col-span-1 md:col-span-4 bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Wand2 className="w-5 h-5 text-purple-400" />
                    <h2 className="text-lg font-semibold">Creative Analysis</h2>
                    {analysis && (
                      <button
                        onClick={handleRegenerateAnalysis}
                        disabled={isRegeneratingAnalysis}
                        className="ml-2 p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Regenerate analysis"
                      >
                        <RefreshCw className={`w-4 h-4 text-purple-400 ${isRegeneratingAnalysis ? 'animate-spin' : ''}`} />
                      </button>
                    )}
                  </div>
                  {analysis?.bpm || onsetData?.detectedBpm ? (
                      <div className="flex items-center gap-2 bg-slate-950 px-3 py-1 rounded-full border border-slate-800">
                          <Activity className="w-4 h-4 text-emerald-400" />
                          <span className="text-sm font-mono text-emerald-400">
                              ~{analysis?.bpm || onsetData?.detectedBpm} BPM
                          </span>
                      </div>
                  ) : null}
                </div>
                
                {!analysis ? (
                   <div className="flex items-center gap-3 text-slate-400 animate-pulse">
                     <div className="h-4 w-4 bg-slate-700 rounded-full"></div> Analyzing...
                   </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="p-4 bg-slate-950 rounded-xl border border-slate-800/50">
                        <label className="text-xs text-slate-500 uppercase tracking-wider">Genre</label>
                        <p className="text-lg font-medium text-indigo-300">{analysis.genre}</p>
                        </div>
                        <div className="p-4 bg-slate-950 rounded-xl border border-slate-800/50">
                        <label className="text-xs text-slate-500 uppercase tracking-wider">Theme</label>
                        <p className="text-lg font-medium text-pink-300">{analysis.theme}</p>
                        </div>
                        <div className="p-4 bg-slate-950 rounded-xl border border-slate-800/50">
                        <label className="text-xs text-slate-500 uppercase tracking-wider">Instruments</label>
                        <div className="flex flex-wrap gap-2 mt-1">
                            {analysis.instruments.map((inst, i) => (
                            <span key={i} className="text-xs px-2 py-1 bg-slate-800 text-cyan-200 rounded-md border border-slate-700">{inst}</span>
                            ))}
                        </div>
                        </div>
                    </div>
                    
                    {/* Lyrics Section */}
                    {analysis.lyrics && (
                        <div className="border-t border-slate-800 pt-4">
                            <button 
                                onClick={() => setShowLyrics(!showLyrics)}
                                className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors w-full"
                            >
                                <Mic2 className="w-4 h-4" />
                                {showLyrics ? "Hide Lyrics" : "Show Lyrics / Content"}
                                {showLyrics ? <ChevronUp className="w-4 h-4 ml-auto" /> : <ChevronDown className="w-4 h-4 ml-auto" />}
                            </button>
                            {showLyrics && (
                                <div className="mt-4 p-4 bg-slate-950 rounded-xl border border-slate-800/50 text-slate-300 text-sm whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                                    {analysis.lyrics}
                                </div>
                            )}
                        </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Waveform */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
               <div className="flex items-center justify-between mb-4">
                 <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Volume2 className="w-5 h-5 text-slate-400" /> Timeline
                 </h2>
                 <span className="text-xs font-mono text-slate-500 bg-slate-950 px-2 py-1 rounded">
                    {currentTime.toFixed(2)}s / {audioState.duration.toFixed(2)}s
                 </span>
               </div>
               <div className="mb-6 relative group">
                  <Waveform buffer={audioState.buffer!} markers={markers} currentTime={currentTime} onSeek={handleSeek} />
                  <div className="absolute top-2 right-2 text-[10px] text-slate-400 bg-slate-950/80 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">Click waveform to seek</div>
               </div>
               <div className="flex justify-center">
                  <button onClick={togglePlay} className="flex items-center justify-center w-14 h-14 bg-indigo-600 hover:bg-indigo-500 rounded-full shadow-lg shadow-indigo-900/50 transition-all hover:scale-105">
                    {isPlaying ? <Pause className="fill-white" /> : <Play className="fill-white ml-1" />}
                  </button>
               </div>
               <audio ref={audioRef} src={audioState.url} onEnded={() => setIsPlaying(false)} className="hidden" />
            </div>

            {/* Controls */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-6">
                    <Settings2 className="w-5 h-5 text-indigo-400" />
                    <h3 className="font-semibold text-slate-200">Cut Configuration</h3>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    {/* Logic Controls */}
                    <div className="space-y-6">
                        
                        {/* Sensitivity */}
                        <div className={`transition-opacity duration-300 ${useCustomCount ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
                            <div className="flex justify-between mb-2">
                                <label className="text-sm font-medium text-slate-300">Beat Sensitivity</label>
                                <span className="text-xs text-indigo-400 font-mono">
                                    {useCustomCount ? 'AUTO' : `${(density * 100).toFixed(0)}%`}
                                </span>
                            </div>
                            <input 
                                type="range" 
                                min="0" 
                                max="1" 
                                step="0.05" 
                                value={density} 
                                onChange={(e) => setDensity(parseFloat(e.target.value))} 
                                disabled={useCustomCount}
                                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                            />
                            <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                                <span>Sparse (Major Drops)</span>
                                <span>Dense (All Beats)</span>
                            </div>
                        </div>

                        {/* Min Duration */}
                        <div>
                             <div className="flex justify-between mb-2">
                                <label className="text-sm font-medium text-slate-300">Min Cut Duration</label>
                                <span className="text-xs text-indigo-400 font-mono">{minDuration}s</span>
                            </div>
                            <input type="range" min="0.5" max="5.0" step="0.1" value={minDuration} onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setMinDuration(val);
                                if (val > maxDuration) setMaxDuration(val);
                            }} className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
                        </div>

                        {/* Max Duration */}
                        <div>
                             <div className="flex justify-between mb-2">
                                <label className="text-sm font-medium text-slate-300">Max Duration (Safety Net)</label>
                                <span className="text-xs text-rose-400 font-mono">{maxDuration}s</span>
                            </div>
                            <input type="range" min="2.0" max="30.0" step="0.5" value={maxDuration} onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setMaxDuration(val);
                                if (val < minDuration) setMinDuration(val);
                            }} className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500" />
                        </div>
                    </div>

                    {/* Custom & Stats */}
                    <div className="border-l border-slate-800 pl-0 lg:pl-12 flex flex-col justify-center space-y-8">
                         <div>
                             <div className="flex items-center gap-2 mb-3">
                                <input type="checkbox" id="useCustom" checked={useCustomCount} onChange={(e) => setUseCustomCount(e.target.checked)} className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-indigo-500" />
                                <label htmlFor="useCustom" className="text-sm font-medium text-slate-300 cursor-pointer">Override with Target Count</label>
                            </div>
                            <input type="number" placeholder="e.g. 24" value={customCount} onChange={(e) => setCustomCount(e.target.value)} disabled={!useCustomCount} className="w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-50" />
                            <p className="text-[10px] text-slate-500 mt-2">Targeting exact count will still respect Min/Max constraints.</p>
                         </div>

                         <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 flex flex-col items-center">
                            <span className="text-4xl font-bold text-indigo-400">{markers.length}</span>
                            <span className="text-xs text-slate-500 uppercase mt-1">Total Cuts Generated</span>
                            <div className="mt-3 pt-3 border-t border-slate-800 w-full text-center">
                              <span className="text-2xl font-bold text-emerald-400">
                                ${(() => {
                                  // Image cost: $0.14 per frame
                                  const imageCost = markers.length * 0.14;

                                  // Video cost based on shot durations
                                  let videoCost = 0;
                                  for (let i = 0; i < markers.length; i++) {
                                    const currentMarker = markers[i];
                                    const nextMarker = markers[i + 1];
                                    const duration = nextMarker
                                      ? nextMarker.time - currentMarker.time
                                      : audioState.duration - currentMarker.time;

                                    // Up to 5s = $0.35, longer than 5s = $0.70
                                    videoCost += duration <= 5 ? 0.35 : 0.70;
                                  }

                                  const totalCost = imageCost + videoCost;
                                  return totalCost.toFixed(2);
                                })()}
                              </span>
                              <div className="text-[10px] text-slate-500 uppercase mt-1">Est. Total Cost</div>
                              <div className="text-[9px] text-slate-600 mt-0.5">
                                Images: ${(markers.length * 0.14).toFixed(2)} |
                                Videos: ≤5s=$0.35 &gt;5s=$0.70
                              </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Marker Preview */}
            <div className="mt-8">
               <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Markers ({markers.length})</h3>
               <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {markers.map((m) => (
                      <div key={m.id} onClick={() => handleSeek(m.time)} className={`cursor-pointer p-2 rounded border text-center transition-colors ${m.type === 'Safety' ? 'bg-rose-950/30 border-rose-900/50 hover:bg-rose-900/50' : 'bg-amber-950/30 border-amber-900/50 hover:bg-amber-900/50'}`}>
                          <div className={`text-xs font-bold ${m.type === 'Safety' ? 'text-rose-400' : 'text-amber-400'}`}>{m.type}</div>
                          <div className="text-sm font-mono text-slate-300">{m.time.toFixed(2)}s</div>
                      </div>
                  ))}
               </div>
            </div>

            {/* PHASE 2 & 3: Video Planner */}
            {analysis && markers.length > 0 && (
                <VideoPlanner
                  analysis={analysis}
                  markers={markers}
                  audioDuration={audioState.duration}
                  aspectRatio={aspectRatio}
                  setAspectRatio={setAspectRatio}
                  visualStyle={visualStyle}
                  setVisualStyle={setVisualStyle}
                  videoPlan={videoPlan}
                  setVideoPlan={setVideoPlan}
                  storyboard={storyboard}
                  setStoryboard={setStoryboard}
                  hierarchyTree={hierarchyTree}
                  setHierarchyTree={setHierarchyTree}
                  useHierarchy={useHierarchy}
                  setUseHierarchy={setUseHierarchy}
                  useConceptualMode={useConceptualMode}
                  setUseConceptualMode={setUseConceptualMode}
                  videoClips={videoClips}
                  setVideoClips={setVideoClips}
                  finalVideoBlob={finalVideoBlob}
                  setFinalVideoBlob={setFinalVideoBlob}
                  onStoryboardUpdate={saveNow}
                />
            )}

          </div>
        )}
      </main>
    </div>
  );
};

export default App;