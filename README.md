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
  - Google Gemini 3 Flash Preview for narrative planning with high-level thinking
  - Google Gemini 3 Pro Image Preview for location reference generation (2K quality)
  - Google Gemini 3 Flash Image for storyboard frame generation
  - Kling 2.5 Turbo Pro (via fal.ai) for video generation
- **Audio Processing**: Web Audio API with custom DSP implementation
- **Video Processing**: FFmpeg.wasm (browser-based) with memory management
- **Storage**: IndexedDB for browser-based project persistence
- **Styling**: Tailwind CSS

## Features

### Core Features
- **Automatic Beat Detection**: Custom "Desperation Threshold Algorithm" for intelligent cut marker placement
- **AI Audio Analysis**: Gemini analyzes genre, theme, instruments, and lyrics
- **Narrative Generation**: Creates cohesive storylines synchronized to music
- **Character Consistency**: Generates character reference sheets for visual continuity
- **Adjustable Sensitivity**: Control beat detection density and duration constraints
- **Video Speed Ramping**: Automatically adjusts clip speeds to match exact beat timing
- **Browser-Based**: Runs entirely in the browser, no server required

### Advanced Features

- **Conceptual Mode**: Choose between literal and symbolic narratives
  - **Literal Mode**: Direct lyric interpretation with clear plot
  - **Conceptual Mode**: Symbolic, atmosphere-driven storytelling that embodies emotional essence
  - Includes 15+ famous music video examples as inspiration
  - Step-by-step creative direction for metaphorical narratives
  - Perfect for atmospheric/experimental music

- **Location System**: Environment consistency matching character system
  - Wide-angle 2K establishing shots for locations
  - Each scene tracks characters AND locations
  - Architectural and spatial detail preservation
  - Parallel batch generation (3x faster)

- **Hierarchical Frame Generation**: Revolutionary parent-child frame relationships
  - Anchor frames serve as parents, variants regenerate as children
  - Regenerate a parent frame and all descendants update automatically
  - Dramatically reduces regeneration time and improves consistency
  - Visual hierarchy indicators with color-coded borders

- **Project Management**: Full save/load system with autosave
  - Multiple projects with automatic persistence (IndexedDB)
  - Auto-generated project names based on audio files
  - Visual save status indicators and timestamps
  - Preserves all phases: audio analysis, markers, storyboard, and video

- **Interactive Storyboard**: Click-to-select frame details
  - Detailed frame viewer with parent-child navigation
  - One-click frame regeneration with impact preview
  - Character and location tags display
  - Interpolation prompts visualization

- **Cost Estimation**: Real-time cost calculator
  - Displays estimated total cost for images and videos
  - Per-frame breakdown ($0.14/image, $0.35-$0.70/video)

- **Concurrent Generation**: Parallel processing for speed
  - Characters: 3 concurrent generations (3x faster)
  - Locations: 3 concurrent generations (3x faster)
  - Videos: 2 clips simultaneously

- **Smart Error Recovery**: Automatic fixes and retries
  - Auto-correct shot count mismatches
  - Retry with progressive safety sanitization
  - Exponential backoff for network errors
  - FFmpeg timeout and memory protection
  - Automatic FFmpeg reload on WASM errors

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
│   ├── VideoPlanner.tsx            # Storyboard and video generation
│   ├── ProjectSelector.tsx         # Project management dropdown
│   ├── FrameCard.tsx               # Individual storyboard frame card
│   └── DetailsPanel.tsx            # Frame details sidebar
├── hooks/
│   └── useProjectAutosave.ts       # Auto-save hook with debouncing
└── services/
    ├── audioProcessingService.ts   # Beat detection and DSP
    ├── geminiService.ts            # Gemini AI integration (narrative, hierarchy)
    ├── klingService.ts             # Kling video API with retry logic
    ├── videoProcessingService.ts   # FFmpeg video processing
    └── projectStorageService.ts    # IndexedDB project persistence
```

## Key Algorithms

### Desperation Threshold Algorithm
A novel approach to beat detection that:
- Uses sliding windows between min/max duration constraints
- Dynamically adjusts threshold to accept weaker beats over time
- Falls back to "safety cuts" if no suitable beat is found
- Balances musical alignment with practical video editing needs

### Character & Location Consistency System
Maintains visual continuity by:
- **Characters**: 1:1 reference sheets with objective physical descriptions
- **Locations**: Wide-angle 2K establishing shots showing architecture and environment
- Both passed as multimodal references to frame generation
- Text labels added for organization
- JPEG compression for efficiency

### Conceptual Mode
Two distinct narrative approaches:

**Literal Mode** (Traditional):
- Direct interpretation of lyrics
- Clear character activities and plot
- "Woman walks to coffee shop, orders drink"

**Conceptual Mode** (Artistic):
- Symbolic, atmosphere-driven storytelling
- Embodies emotional essence, not literal lyrics
- Visual motifs and recurring symbols
- "Figure embodying isolation, dissolving through refracted light"

**Built-in Examples**: Includes 15 famous music videos:
- Taylor Swift "Anti-Hero" (surreal self-loathing)
- Childish Gambino "This Is America" (symbolic commentary)
- Arctic Monkeys "Do I Wanna Know" (abstract soundwave)
- FKA twigs "Cellophane" (performance art vulnerability)

### Hierarchical Frame Generation
Revolutionary approach that transforms storyboard generation:

**Traditional Sequential Generation:**
```
Frame 1 → Frame 2 → Frame 3 → Frame 4 → ...
(Each frame depends on the previous one)
```

**Hierarchical Generation:**
```
Frame 1 (Anchor/Parent)
    ↓
Frame 2 (Child)
    ↓
Frame 3 (Grandchild)

Frame 4 (Anchor/Parent) ← Independent!
    ↓
Frame 5 (Child)
```

**Key Benefits:**
- **Reduced Regeneration Cascade**: Regenerating a frame only affects its descendants, not the entire sequence
- **Parallel Generation**: Parent frames can be generated simultaneously since they're independent
- **Better Consistency**: Children explicitly reference their parent frame + transformation instructions
- **Intelligent Anchors**: System scores each frame for "anchor-worthiness" based on action keywords
- **Transformation Deltas**: Gemini analyzes parent-child relationships to create precise transformation instructions

**How It Works:**
1. Analyze narrative to identify anchor moments (explosions, revelations, key actions)
2. Score each frame and select parents based on distribution and importance
3. Build parent-child tree with depth tracking
4. Generate transformation deltas describing exact changes between parent and child
5. Generate frames: parents independently, children from their parent + delta
6. Visual indicators: Color-coded borders show depth (blue=parent, purple=child, indigo=grandchild)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Google Gemini for AI narrative and image generation
- fal.ai for Kling video generation API
- FFmpeg.wasm for browser-based video processing
