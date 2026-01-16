/** @format */

import { NextResponse } from 'next/server';
import { auth } from '@/app/api/auth/[...nextauth]/route';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

// Helper function to generate thumbnails with FFmpeg
async function generateThumbnail(filePath, thumbnailPath, isVideo) {
  const ffmpegArgs = ['-y', '-i', filePath];

  if (isVideo) {
    ffmpegArgs.push('-ss', '00:00:01.000');
  }

  // Extract only the first frame
  ffmpegArgs.push('-frames:v', '1');

  // Optimize: smaller size, faster compression
  ffmpegArgs.push(
    '-vf',
    'scale=200:200:force_original_aspect_ratio=decrease,pad=200:200:(ow-iw)/2:(oh-ih)/2:color=black@0',
    '-compression_level',
    '6', // Faster PNG compression (0-9, lower = faster)
    thumbnailPath
  );

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error('FFmpeg failed with code:', code);
        console.error('FFmpeg error output:', errorOutput);
        reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput}`));
      }
    });

    ffmpeg.on('error', (err) => {
      console.error('FFmpeg spawn error:', err);
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

// Helper function to generate PDF thumbnails
async function generatePdfThumbnail(filePath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    // Use ImageMagick's magick command directly (requires Ghostscript for PDF support)
    const args = [
      '-density',
      '150',
      `${filePath}[0]`, // First page only - must come after density
      '-trim',
      '-quality',
      '100',
      '-flatten',
      '-sharpen',
      '0x1.0',
      '-resize',
      '200x200',
      thumbnailPath,
    ];

    const magick = spawn('magick', args);
    let errorOutput = '';

    magick.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    magick.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error('ImageMagick PDF failed with code:', code);
        console.error('ImageMagick error output:', errorOutput);
        if (errorOutput.includes('gswin') || errorOutput.includes('Ghostscript')) {
          reject(new Error('Ghostscript is required for PDF thumbnails. Install from https://ghostscript.com/releases/gsdnld.html'));
        } else {
          reject(new Error(`ImageMagick PDF exited with code ${code}`));
        }
      }
    });

    magick.on('error', (err) => {
      console.error('ImageMagick spawn error:', err);
      reject(new Error(`ImageMagick spawn error: ${err.message}`));
    });
  });
}

export async function GET(req, { params }) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const fileId = decodeURIComponent(resolvedParams.id);

    // Get path from query params
    const url = new URL(req.url);
    const relativePath = url.searchParams.get('path') || '';

    // Security: prevent directory traversal
    if (relativePath.includes('..') || fileId.includes('..')) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const uploadsDir = path.join(process.cwd(), 'uploads');
    const thumbnailsDir = path.join(process.cwd(), 'thumbnails');
    const filePath = path.join(uploadsDir, relativePath, fileId);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Get file extension for type detection
    const fileExt = path.extname(fileId).toLowerCase();

    // Supported image, video, and PDF extensions
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg'];
    const pdfExtensions = ['.pdf'];

    const isImage = imageExtensions.includes(fileExt);
    const isVideo = videoExtensions.includes(fileExt);
    const isPdf = pdfExtensions.includes(fileExt);

    if (!isImage && !isVideo && !isPdf) {
      return NextResponse.json({ error: 'Thumbnail generation not supported for this file type' }, { status: 404 });
    }

    // Create thumbnail filename - always use PNG format
    const thumbnailFileName = `${relativePath.replace(/[/\\]/g, '_')}_${fileId}.png`;
    const thumbnailPath = path.join(thumbnailsDir, thumbnailFileName);

    // Ensure thumbnails directory exists
    if (!fs.existsSync(thumbnailsDir)) {
      fs.mkdirSync(thumbnailsDir, { recursive: true });
    }

    // Check for old JPG thumbnail and delete it
    const oldJpgThumbnailFileName = `${relativePath.replace(/[/\\]/g, '_')}_${fileId}.jpg`;
    const oldJpgThumbnailPath = path.join(thumbnailsDir, oldJpgThumbnailFileName);
    if (fs.existsSync(oldJpgThumbnailPath)) {
      fs.unlinkSync(oldJpgThumbnailPath);
    }

    // Check if PNG thumbnail already exists
    if (fs.existsSync(thumbnailPath)) {
      const thumbnailBuffer = fs.readFileSync(thumbnailPath);
      return new NextResponse(thumbnailBuffer, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    // Generate thumbnail for videos and images using ffmpeg (PNG format)
    try {
      if (isPdf) {
        await generatePdfThumbnail(filePath, thumbnailPath);
      } else {
        await generateThumbnail(filePath, thumbnailPath, isVideo);
      }

      if (fs.existsSync(thumbnailPath)) {
        const thumbnailBuffer = fs.readFileSync(thumbnailPath);
        return new NextResponse(thumbnailBuffer, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000',
          },
        });
      }
    } catch (error) {
      console.error(`Thumbnail generation failed for ${isPdf ? 'PDF' : isVideo ? 'video' : 'image'}:`, error.message);
      // Return 404 so the UI can fall back to the icon
      return NextResponse.json(
        {
          error: 'Thumbnail generation not available',
          message: 'FFmpeg is required for thumbnails. Install it from https://ffmpeg.org/download.html',
        },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Thumbnail generation error:', error);
    return NextResponse.json({ error: 'Thumbnail generation failed' }, { status: 500 });
  }
}
