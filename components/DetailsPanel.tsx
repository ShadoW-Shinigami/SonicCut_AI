import React from 'react';
import { StoryboardFrame, HierarchyNode, HierarchyTree } from '../types';
import { RefreshCw, Layers, X } from 'lucide-react';

interface DetailsPanelProps {
  frame: StoryboardFrame;
  frameIndex: number;
  hierarchyNode?: HierarchyNode;
  hierarchyTree?: HierarchyTree;
  allFrames: StoryboardFrame[];
  aspectRatio: string;
  onSelectFrame: (index: number) => void;
  onRegenerate: (frameIndex: number) => void;
  isGenerating: boolean;
}

export const DetailsPanel: React.FC<DetailsPanelProps> = ({
  frame,
  frameIndex,
  hierarchyNode,
  hierarchyTree,
  allFrames,
  aspectRatio,
  onSelectFrame,
  onRegenerate,
  isGenerating
}) => {
  // Calculate descendants for regeneration count
  const collectDescendants = (idx: number): number[] => {
    if (!hierarchyTree || !hierarchyNode) return [];

    const node = hierarchyTree.nodes[idx];
    if (!node) return [];

    const descendants: number[] = [];
    const visited = new Set<number>([idx]); // Track visited nodes to prevent infinite loops
    const queue = [...node.childIndices];

    while (queue.length > 0) {
      const childIdx = queue.shift()!;

      // Skip if already visited (circular reference protection)
      if (visited.has(childIdx)) continue;

      visited.add(childIdx);
      descendants.push(childIdx);

      const childNode = hierarchyTree.nodes[childIdx];
      if (childNode) {
        queue.push(...childNode.childIndices);
      }
    }

    return descendants;
  };

  const descendants = collectDescendants(frameIndex);

  const getAspectClass = () => {
    if (aspectRatio === '9:16') return 'aspect-[9/16]';
    if (aspectRatio === '1:1') return 'aspect-square';
    return 'aspect-video';
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
      {/* Close Button */}
      <button
        onClick={() => onSelectFrame(null as any)}
        className="absolute top-4 right-4 p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors z-10"
        title="Close details panel"
      >
        <X className="w-4 h-4 text-slate-400" />
      </button>

      {/* Large Preview */}
      <div className={`w-full ${getAspectClass()} bg-black rounded-lg mb-4 overflow-hidden`}>
        {frame.imageUrl ? (
          <img src={`data:image/jpeg;base64,${frame.imageUrl}`} alt="Frame preview" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600 text-sm">
            No image yet
          </div>
        )}
      </div>

      {/* Frame Info */}
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-slate-100 mb-2">Shot {frameIndex + 1}</h3>
        <p className="text-xs text-slate-400 mb-2">{frame.startTime.toFixed(2)}s</p>

        {/* Hierarchy Badge */}
        {hierarchyNode && (
          <div className="flex items-center gap-2 mb-3">
            {hierarchyNode.depth === 0 ? (
              <span className="bg-blue-900/50 text-blue-200 px-3 py-1 rounded-full text-xs font-bold border border-blue-700">
                🏆 Anchor Frame (Parent)
              </span>
            ) : (
              <span className="bg-purple-900/50 text-purple-200 px-3 py-1 rounded-full text-xs border border-purple-700">
                Child (Depth {hierarchyNode.depth})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Description */}
      <div className="mb-4">
        <h4 className="text-xs text-slate-500 uppercase font-bold mb-2">Description</h4>
        <p className="text-sm text-slate-300 leading-relaxed">{frame.description}</p>
      </div>

      {/* Lineage */}
      {hierarchyNode && hierarchyTree && (
        <div className="mb-4">
          <h4 className="text-xs text-slate-500 uppercase font-bold mb-2 flex items-center gap-2">
            <Layers className="w-3 h-3" /> Lineage
          </h4>

          {/* Parent */}
          {hierarchyNode.parentIndex !== null && (
            <div className="mb-3">
              <span className="text-xs text-slate-600 block mb-1">Parent</span>
              <button
                onClick={() => onSelectFrame(hierarchyNode.parentIndex!)}
                className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors text-left"
              >
                <div className="text-xs text-slate-300">
                  Shot {hierarchyNode.parentIndex + 1}: {allFrames[hierarchyNode.parentIndex].description.slice(0, 60)}...
                </div>
              </button>
            </div>
          )}

          {/* Children */}
          {hierarchyNode.childIndices.length > 0 && (
            <div>
              <span className="text-xs text-slate-600 block mb-1">
                Children ({hierarchyNode.childIndices.length})
              </span>
              <div className="space-y-1">
                {hierarchyNode.childIndices.map(childIdx => (
                  <button
                    key={childIdx}
                    onClick={() => onSelectFrame(childIdx)}
                    className="w-full p-2 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors text-left"
                  >
                    <div className="text-xs text-slate-300">
                      Shot {childIdx + 1}: {allFrames[childIdx].description.slice(0, 50)}...
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Transformation Delta */}
      {hierarchyNode && hierarchyNode.transformationDelta && (
        <div className="mb-4 bg-slate-950 border border-slate-700 rounded-lg p-4">
          <h4 className="text-xs text-slate-500 uppercase font-bold mb-3">Transformation Instructions</h4>
          <div className="space-y-2 text-xs">
            <div>
              <span className="text-slate-600">Camera:</span>
              <p className="text-slate-300 mt-1">{hierarchyNode.transformationDelta.cameraOperation}</p>
            </div>
            <div>
              <span className="text-slate-600">Framing:</span>
              <p className="text-slate-300 mt-1">{hierarchyNode.transformationDelta.framingChange}</p>
            </div>
            <div>
              <span className="text-slate-600">Background:</span>
              <p className="text-slate-300 mt-1">{hierarchyNode.transformationDelta.backgroundElements}</p>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate Section */}
      <div className="mt-6">
        <button
          onClick={() => onRegenerate(frameIndex)}
          disabled={isGenerating}
          className="w-full bg-pink-600 hover:bg-pink-500 disabled:bg-slate-700 disabled:text-slate-500 text-white py-3 px-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Regenerate{descendants.length > 0 ? ` + ${descendants.length} frames` : ''}
        </button>

        {descendants.length > 0 && (
          <p className="text-xs text-slate-500 mt-2 text-center">
            ⚠️ Will also regenerate {descendants.length} dependent frame{descendants.length > 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
};
