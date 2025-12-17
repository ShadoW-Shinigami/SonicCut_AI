import React from 'react';
import { StoryboardFrame, HierarchyNode, Character, Location } from '../types';
import { Loader2, RefreshCw, PlayCircle, AlertTriangle, MapPin } from 'lucide-react';

interface FrameCardProps {
  frame: StoryboardFrame;
  index: number;
  hierarchyNode?: HierarchyNode;
  characters: Character[];
  locations: Location[];
  aspectRatio: string;
  isSelected: boolean;
  isGenerating: boolean;
  onSelect: () => void;
  onRegenerate: () => void;
}

export const FrameCard: React.FC<FrameCardProps> = ({
  frame,
  index,
  hierarchyNode,
  characters,
  locations,
  aspectRatio,
  isSelected,
  isGenerating,
  onSelect,
  onRegenerate
}) => {
  // Determine border style based on hierarchy depth
  const getBorderStyle = () => {
    if (!hierarchyNode) return 'border-slate-800';

    if (hierarchyNode.depth === 0) {
      return 'border-4 border-blue-500'; // Parent - thick blue border
    } else if (hierarchyNode.depth === 1) {
      return 'border-2 border-purple-500'; // Child - purple border
    } else {
      return 'border-2 border-indigo-500 border-dashed'; // Grandchild+ - dashed indigo
    }
  };

  // Determine aspect ratio class
  const getAspectClass = () => {
    if (aspectRatio === '9:16') return 'aspect-[9/16]';
    if (aspectRatio === '1:1') return 'aspect-square';
    return 'aspect-video';
  };

  return (
    <div
      onClick={onSelect}
      className={`flex-shrink-0 cursor-pointer transition-all ${
        isSelected ? 'ring-4 ring-pink-500 ring-offset-2 ring-offset-slate-950' : ''
      }`}
    >
      <div className={`w-64 bg-slate-900 rounded-xl ${getBorderStyle()} overflow-hidden flex flex-col relative group/card hover:shadow-xl transition-shadow`}>

        {/* Parent Badge */}
        {hierarchyNode?.depth === 0 && (
          <div className="absolute top-2 right-2 z-20 text-lg">🏆</div>
        )}

        {/* Header */}
        <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-800 flex justify-between items-center">
          <span className="text-xs font-mono text-pink-400">Shot {index + 1}</span>
          <div className="flex items-center gap-2">
            {hierarchyNode && hierarchyNode.depth > 0 && (
              <span className="text-[9px] text-slate-500">D{hierarchyNode.depth}</span>
            )}
            <span className="text-xs font-mono text-slate-500">{frame.startTime.toFixed(2)}s</span>
          </div>
        </div>

        {/* Image Area */}
        <div className={`w-full ${getAspectClass()} bg-black relative flex items-center justify-center`}>
          {/* Active Characters and Locations Tags */}
          <div className="absolute top-2 left-2 flex flex-col gap-1 z-10 pointer-events-none">
            {/* Character Tags */}
            {frame.characterIds && frame.characterIds.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {frame.characterIds.map(cid => {
                  const char = characters.find(c => c.id === cid);
                  return char ? (
                    <span key={cid} className="text-[8px] bg-black/60 text-white px-2 py-0.5 rounded backdrop-blur-md border border-white/10">
                      {char.name}
                    </span>
                  ) : null;
                })}
              </div>
            )}

            {/* Location Tags */}
            {frame.locationIds && frame.locationIds.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {frame.locationIds.map(lid => {
                  const loc = locations.find(l => l.id === lid);
                  return loc ? (
                    <span key={lid} className="text-[8px] bg-emerald-900/60 text-emerald-200 px-2 py-0.5 rounded backdrop-blur-md border border-emerald-400/30 flex items-center gap-1">
                      <MapPin className="w-2 h-2" />
                      {loc.name}
                    </span>
                  ) : null;
                })}
              </div>
            )}
          </div>

          {frame.imageUrl ? (
            <img src={`data:image/jpeg;base64,${frame.imageUrl}`} alt="Scene" className="w-full h-full object-cover" />
          ) : frame.isGenerating ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 text-pink-500 animate-spin" />
              <span className="text-xs text-pink-500 font-mono">Generating...</span>
            </div>
          ) : frame.error ? (
            <div className="flex flex-col items-center gap-2 text-red-400 p-2 text-center">
              <AlertTriangle className="w-8 h-8" />
              <span className="text-xs font-bold">Failed</span>
              <span className="text-[10px] opacity-70">After 3 attempts</span>
            </div>
          ) : (
            <span className="text-xs text-slate-600">Waiting to render</span>
          )}

          {/* Hover Overlay */}
          <div className="absolute inset-0 bg-black/80 p-4 opacity-0 group-hover/card:opacity-100 transition-opacity flex flex-col justify-between text-center">
            <div className="flex-1 flex items-center justify-center overflow-hidden">
              <p className="text-xs text-slate-300 line-clamp-5">{frame.description}</p>
            </div>

            {/* Action Buttons on Hover */}
            {!isGenerating && (
              <div className="flex gap-2 mt-2 flex-shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRegenerate();
                  }}
                  disabled={isGenerating}
                  title="Regenerate this frame"
                  className="flex-1 p-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span className="text-xs">Regen</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-900 relative">
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Transition Prompt</div>
          <p className="text-xs text-indigo-300 line-clamp-3">{frame.interpolationPrompt}</p>

          {/* Manual Retry Button if Error */}
          {frame.error && !isGenerating && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRegenerate();
              }}
              className="absolute inset-0 bg-slate-900/90 flex items-center justify-center gap-2 text-red-400 hover:text-red-300 font-bold text-xs transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Retry Frame
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
