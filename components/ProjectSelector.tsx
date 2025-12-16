import React, { useState, useEffect, useRef } from 'react';
import { listProjects, deleteProject } from '../services/projectStorageService';
import { ProjectMetadata } from '../types';
import { FolderOpen, Settings, ChevronDown, Save, Loader2, Plus, Trash2 } from 'lucide-react';

interface ProjectSelectorProps {
  projectName: string;
  isSaving: boolean;
  lastSaved: Date | null;
  onLoadProject: (projectId: string) => void;
  onNewProject: () => void;
  onRenameProject: (newName: string) => Promise<void>;
  onDeleteProject: () => void;
  hasActiveProject: boolean;
}

const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  projectName,
  isSaving,
  lastSaved,
  onLoadProject,
  onNewProject,
  onRenameProject,
  onDeleteProject,
  hasActiveProject,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(projectName);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      loadProjectList();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsEditing(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadProjectList = async () => {
    try {
      const list = await listProjects();
      setProjects(list);
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  };

  const handleRename = async () => {
    if (editName.trim() && editName !== projectName) {
      await onRenameProject(editName.trim());
    }
    setIsEditing(false);
  };

  const handleDelete = async (projectId: string) => {
    if (confirm('Delete this project? This cannot be undone.')) {
      await deleteProject(projectId);
      loadProjectList();
      onDeleteProject();
    }
  };

  const formatTimeAgo = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Main Button */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
        >
          <FolderOpen className="w-4 h-4 text-indigo-400" />
          <span className="font-medium text-slate-200">
            {hasActiveProject ? projectName : 'Load Project'}
          </span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Settings Button - only show when active project */}
        {hasActiveProject && (
          <button
            onClick={() => setIsEditing(true)}
            className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
            title="Project Settings"
          >
            <Settings className="w-4 h-4 text-slate-400" />
          </button>
        )}

        {/* Save Indicator - only show when active project */}
        {hasActiveProject && (
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/50 border border-slate-800 rounded-lg">
            {isSaving ? (
              <>
                <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />
                <span className="text-xs text-slate-400">Saving...</span>
              </>
            ) : lastSaved ? (
              <>
                <Save className="w-3 h-3 text-emerald-400" />
                <span className="text-xs text-slate-400">Saved</span>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-96 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="p-3 border-b border-slate-800">
            <h3 className="text-sm font-semibold text-slate-300">Recent Projects</h3>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {projects.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-sm">
                No saved projects yet
              </div>
            ) : (
              projects.map((project) => (
                <div
                  key={project.id}
                  className="p-3 hover:bg-slate-800/50 cursor-pointer border-b border-slate-800/50 last:border-b-0 transition-colors"
                  onClick={() => {
                    onLoadProject(project.id);
                    setIsOpen(false);
                  }}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium text-slate-200 text-sm">{project.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(project.id);
                      }}
                      className="p-1 hover:bg-red-900/20 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  </div>
                  <div className="text-xs text-slate-500">
                    {project.audioFileName} • {project.markerCount} cuts
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    {formatTimeAgo(project.updatedAt)}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t border-slate-800">
            <button
              onClick={() => {
                onNewProject();
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {isEditing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-96">
            <h3 className="text-lg font-semibold text-slate-200 mb-4">Rename Project</h3>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              className="w-full px-4 py-2 bg-slate-950 border border-slate-700 text-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handleRename}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditName(projectName);
                }}
                className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectSelector;
