import React, { useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { Marker } from '../types';

interface WaveformProps {
  buffer: AudioBuffer;
  markers: Marker[];
  currentTime: number;
  onSeek: (time: number) => void;
}

const Waveform: React.FC<WaveformProps> = ({ buffer, markers, currentTime, onSeek }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Downsample buffer for visualization performance
  const waveformData = useMemo(() => {
    const rawData = buffer.getChannelData(0);
    const samples = 1000; // Total points to render
    const blockSize = Math.floor(rawData.length / samples);
    const data = [];
    
    for (let i = 0; i < samples; i++) {
      let sum = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[start + j]);
      }
      data.push({ x: i, y: sum / blockSize });
    }
    return data;
  }, [buffer]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = containerRef.current.clientWidth;
    const height = 200;
    
    svg.attr("width", width).attr("height", height);
    svg.selectAll("*").remove();

    // Scales
    const xScale = d3.scaleLinear()
      .domain([0, waveformData.length - 1])
      .range([0, width]);

    const yScale = d3.scaleLinear()
      .domain([0, d3.max(waveformData, d => d.y) || 1])
      .range([height, 0]);

    // Waveform Area
    const area = d3.area<{x: number, y: number}>()
      .x(d => xScale(d.x))
      .y0(height)
      .y1(d => yScale(d.y))
      .curve(d3.curveMonotoneX);

    // Gradient
    const gradient = svg.append("defs")
      .append("linearGradient")
      .attr("id", "wave-gradient")
      .attr("x1", "0%")
      .attr("y1", "0%")
      .attr("x2", "0%")
      .attr("y2", "100%");

    gradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#8b5cf6"); // violet-500
    
    gradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#3b82f6"); // blue-500

    // Draw Waveform
    svg.append("path")
      .datum(waveformData)
      .attr("fill", "url(#wave-gradient)")
      .attr("opacity", 0.6)
      .attr("d", area);

    // Click to seek
    svg.on("click", (event) => {
      const [x] = d3.pointer(event);
      const percent = x / width;
      onSeek(percent * buffer.duration);
    });

  }, [waveformData, buffer.duration, onSeek]);

  // Marker and Playhead Rendering (Done separately to avoid full re-render of path)
  useEffect(() => {
      if (!svgRef.current || !containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = 200;
      const svg = d3.select(svgRef.current);

      // Remove old overlays
      svg.selectAll(".marker-line").remove();
      svg.selectAll(".playhead").remove();

      const timeToX = (t: number) => (t / buffer.duration) * width;

      // Draw Markers
      svg.selectAll(".marker-line")
          .data(markers)
          .enter()
          .append("line")
          .attr("class", "marker-line")
          .attr("x1", d => timeToX(d.time))
          .attr("x2", d => timeToX(d.time))
          .attr("y1", 0)
          .attr("y2", height)
          .attr("stroke", d => d.type === 'Safety' ? "#f43f5e" : "#fbbf24") // Rose for safety, Amber for cut
          .attr("stroke-width", 2)
          .attr("stroke-dasharray", d => d.type === 'Safety' ? "4 2" : "none");

      // Draw Playhead
      svg.append("line")
          .attr("class", "playhead")
          .attr("x1", timeToX(currentTime))
          .attr("x2", timeToX(currentTime))
          .attr("y1", 0)
          .attr("y2", height)
          .attr("stroke", "#ffffff")
          .attr("stroke-width", 2);

  }, [markers, currentTime, buffer.duration]);

  return (
    <div ref={containerRef} className="w-full bg-slate-900 rounded-lg overflow-hidden shadow-inner border border-slate-800">
      <svg ref={svgRef} className="w-full h-[200px] cursor-pointer"></svg>
    </div>
  );
};

export default Waveform;
