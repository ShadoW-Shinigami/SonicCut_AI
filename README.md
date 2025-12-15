# SonicCut AI

AI-powered music video production tool that automatically generates beat-synchronized cut markers, creates storyboard frames, and produces complete music videos using AI.

## Overview

SonicCut AI is a React/TypeScript web application that transforms audio files into complete music videos through a three-phase pipeline:

1. **Audio Analysis & Beat Detection** - Analyzes audio using custom DSP algorithms to detect beats and generate cut markers
2. **Video Storyboard Generation** - Uses Google Gemini AI to create narrative plans and generate storyboard frames with character consistency
3. **Video Generation & Stitching** - Generates video clips using Kling AI and stitches them together with FFmpeg

## Technology Stack

- **Frontend**: React 19, TypeScript, Vite
- **AI Models**:
  - Google Gemini 2.5 (Flash & Flash-Image) for narrative and storyboard generation
  - Kling 2.5 Turbo Pro (via fal.ai) for video generation
- **Audio Processing**: Web Audio API with custom DSP implementation
- **Video Processing**: FFmpeg.wasm (browser-based)
- **Styling**: Tailwind CSS

## Features

- **Automatic Beat Detection**: Custom "Desperation Threshold Algorithm" for intelligent cut marker placement
- **AI Audio Analysis**: Gemini analyzes genre, theme, instruments, and lyrics
- **Narrative Generation**: Creates cohesive storylines synchronized to music
- **Character Consistency**: Generates character reference sheets for visual continuity
- **Image-to-Image Pipeline**: Each storyboard frame references the previous for smooth transitions
- **Adjustable Sensitivity**: Control beat detection density and duration constraints
- **Video Speed Ramping**: Automatically adjusts clip speeds to match exact beat timing
- **Browser-Based**: Runs entirely in the browser, no server required

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- Google Gemini API key
- fal.ai API key (for video generation)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/SonicCut_AI.git
cd SonicCut_AI
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file in the root directory:
```
GEMINI_API_KEY=your_gemini_key_here
FAL_KEY=your_fal_ai_key_here
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

### Build for Production

```bash
npm run build
npm run preview
```

## Usage

1. **Upload Audio**: Drag and drop an audio file (MP3, WAV, etc.)
2. **Adjust Settings**: Set beat detection sensitivity and duration constraints
3. **Generate Markers**: Review the automatically generated cut markers on the waveform
4. **Create Storyboard**: Generate AI storyboard frames synchronized to markers
5. **Generate Video**: Produce and stitch video clips into final music video
6. **Export**: Download the completed video

## Project Structure

```
/
├── App.tsx                          # Main application orchestrator
├── types.ts                         # TypeScript type definitions
├── components/
│   ├── FileUpload.tsx              # Audio file upload component
│   ├── Waveform.tsx                # Waveform visualization
│   └── VideoPlanner.tsx            # Storyboard and video generation
└── services/
    ├── audioProcessingService.ts   # Beat detection and DSP
    ├── geminiService.ts            # Gemini AI integration
    ├── klingService.ts             # Kling video API
    └── videoProcessingService.ts   # FFmpeg video processing
```

## Key Algorithms

### Desperation Threshold Algorithm
A novel approach to beat detection that:
- Uses sliding windows between min/max duration constraints
- Dynamically adjusts threshold to accept weaker beats over time
- Falls back to "safety cuts" if no suitable beat is found
- Balances musical alignment with practical video editing needs

### Character Consistency System
Maintains visual continuity by:
- Generating 1:1 character reference sheets
- Passing reference images to subsequent frame generation
- Using multimodal prompting for consistent character appearance

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Google Gemini for AI narrative and image generation
- fal.ai for Kling video generation API
- FFmpeg.wasm for browser-based video processing
