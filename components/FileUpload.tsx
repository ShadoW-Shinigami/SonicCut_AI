import React, { useCallback } from 'react';
import { UploadCloud } from 'lucide-react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, isProcessing }) => {
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (isProcessing) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('audio/')) {
        onFileSelect(file);
      } else {
        alert("Please upload an audio file (MP3/WAV).");
      }
    }
  }, [onFileSelect, isProcessing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div 
      className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 
        ${isProcessing ? 'border-slate-700 opacity-50 cursor-not-allowed' : 'border-indigo-500/50 hover:border-indigo-400 hover:bg-slate-900/50 cursor-pointer'}
      `}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <input 
        type="file" 
        id="file-upload" 
        className="hidden" 
        accept="audio/*" 
        onChange={handleChange} 
        disabled={isProcessing}
      />
      <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
        <UploadCloud className="w-16 h-16 text-indigo-400 mb-4" />
        <h3 className="text-xl font-bold text-slate-200">
          {isProcessing ? "Processing..." : "Upload Audio File"}
        </h3>
        <p className="text-slate-400 mt-2">Drag & Drop or Click to Browse (MP3, WAV)</p>
      </label>
    </div>
  );
};

export default FileUpload;
