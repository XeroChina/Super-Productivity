#!/usr/bin/env node
'use strict';

/**
 * Packages the unpacked Windows x64 Electron output into a portable directory structure:
 *
 *   Super Productivity/
 *   ├── Super Productivity.exe   (lightweight native Windows GUI launcher with app icon)
 *   ├── portable                 (flag file that activates portable mode)
 *   ├── Data/                    (all user files, settings, backups, logs, clipboard-images)
 *   └── Program/                 (all Electron runtime files & resources)
 *       └── Super Productivity.exe
 *
 * And creates:
 *   .tmp/app-builds/Super-Productivity-Portable-x64.zip
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_BUILD_DIR = path.join(ROOT, '.tmp', 'app-builds');

/**
 * Builds a valid multi-resolution Windows .ico buffer from PNG files.
 * Modern Windows (Vista+) natively supports PNG-compressed frames inside .ico files.
 */
const buildIcoFromPngs = (pngPaths) => {
  const frames = pngPaths
    .filter((p) => fs.existsSync(p))
    .map((p) => {
      const data = fs.readFileSync(p);
      // PNG IHDR starts at byte 16: width (4B BE), height (4B BE)
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);
      return {
        width: width >= 256 ? 0 : width,
        height: height >= 256 ? 0 : height,
        data,
      };
    });

  if (frames.length === 0) {
    throw new Error('No PNG files found to build icon.ico');
  }

  const headerSize = 6;
  const dirEntrySize = 16;
  let dataOffset = headerSize + dirEntrySize * frames.length;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(frames.length, 4);

  const dirEntries = [];
  const imageBuffers = [];

  for (const frame of frames) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(frame.width, 0);
    entry.writeUInt8(frame.height, 1);
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(frame.data.length, 8);
    entry.writeUInt32LE(dataOffset, 12);

    dirEntries.push(entry);
    imageBuffers.push(frame.data);
    dataOffset += frame.data.length;
  }

  return Buffer.concat([header, ...dirEntries, ...imageBuffers]);
};

const LAUNCHER_CS_SOURCE = `using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("Super Productivity Launcher")]
[assembly: AssemblyProduct("Super Productivity")]
[assembly: AssemblyDescription("Portable Launcher for Super Productivity")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace SuperProductivityLauncher
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string targetExe = Path.Combine(baseDir, "Program", "Super Productivity.exe");

            if (!File.Exists(targetExe))
            {
                MessageBox.Show(
                    "Cannot find main executable:\\n" + targetExe,
                    "Super Productivity Launcher",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }

            string dataDir = Path.Combine(baseDir, "Data");
            if (!Directory.Exists(dataDir))
            {
                try { Directory.CreateDirectory(dataDir); } catch { }
            }

            string portableFlag = Path.Combine(baseDir, "portable");
            if (!File.Exists(portableFlag))
            {
                try { File.WriteAllText(portableFlag, ""); } catch { }
            }

            StringBuilder argBuilder = new StringBuilder();
            foreach (string arg in args)
            {
                if (argBuilder.Length > 0) argBuilder.Append(' ');
                argBuilder.Append(QuoteArgument(arg));
            }

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = targetExe,
                Arguments = argBuilder.ToString(),
                WorkingDirectory = baseDir,
                UseShellExecute = false
            };

            try
            {
                Process.Start(psi);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Failed to launch Super Productivity:\\n" + ex.Message,
                    "Super Productivity Launcher",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return 1;
            }
        }

        static string QuoteArgument(string arg)
        {
            if (string.IsNullOrEmpty(arg)) return "\\"\\"";
            if (arg.IndexOfAny(new[] { ' ', '\\t', '\\n', '\\v', '\\"' }) == -1)
            {
                return arg;
            }
            return "\\"" + arg.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"") + "\\"";
        }
    }
}
`;

const findCscExe = () => {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  throw new Error('Could not find csc.exe (.NET Framework C# compiler) on this Windows machine');
};

const compileLauncher = (outputExePath, tempDir) => {
  const icoPath = path.join(tempDir, 'launcher.ico');
  const csPath = path.join(tempDir, 'Launcher.cs');

  const pngPaths = [
    path.join(ROOT, 'build', 'icons', '16x16.png'),
    path.join(ROOT, 'build', 'icons', '32x32.png'),
    path.join(ROOT, 'build', 'icons', '48x48.png'),
    path.join(ROOT, 'build', 'icons', '64x64.png'),
    path.join(ROOT, 'build', 'icons', '128x128.png'),
    path.join(ROOT, 'build', 'icons', '256x256.png'),
  ];
  fs.writeFileSync(icoPath, buildIcoFromPngs(pngPaths));
  fs.writeFileSync(csPath, LAUNCHER_CS_SOURCE, 'utf8');

  const csc = findCscExe();
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/platform:x64',
      `/win32icon:${icoPath}`,
      `/out:${outputExePath}`,
      '/reference:System.Windows.Forms.dll',
      csPath,
    ],
    { stdio: 'inherit' },
  );
};

const buildWindowsPortableLayout = (buildDir = DEFAULT_BUILD_DIR) => {
  const unpackedDir = path.join(buildDir, 'win-unpacked');
  if (!fs.existsSync(unpackedDir)) {
    throw new Error(`Unpacked Windows build not found at ${unpackedDir}`);
  }

  const portableRootName = 'Super Productivity';
  const stagingParent = path.join(buildDir, 'portable-staging');
  const portableRoot = path.join(stagingParent, portableRootName);
  const programDir = path.join(portableRoot, 'Program');
  const dataDir = path.join(portableRoot, 'Data');
  const tempDir = path.join(buildDir, 'launcher-tmp');

  fs.rmSync(stagingParent, { recursive: true, force: true });
  fs.rmSync(tempDir, { recursive: true, force: true });

  fs.mkdirSync(programDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  console.log('[portable] Copying Electron runtime into Program/...');
  fs.cpSync(unpackedDir, programDir, { recursive: true });

  // Place `portable` marker file in root (and a `.gitkeep` in Data/ so zip preserves Data/)
  fs.writeFileSync(path.join(portableRoot, 'portable'), '', 'utf8');
  fs.writeFileSync(path.join(dataDir, '.keep'), '', 'utf8');

  // Compile Super Productivity.exe launcher in root
  const launcherExe = path.join(portableRoot, 'Super Productivity.exe');
  console.log('[portable] Compiling root launcher Super Productivity.exe...');
  compileLauncher(launcherExe, tempDir);
  fs.rmSync(tempDir, { recursive: true, force: true });

  // Create ZIP archive
  const zipPath = path.join(buildDir, 'Super-Productivity-Portable-x64.zip');
  fs.rmSync(zipPath, { force: true });
  console.log(`[portable] Creating ${zipPath}...`);

  try {
    execFileSync('7z', ['a', '-tzip', '-mx=7', zipPath, portableRoot], {
      stdio: 'inherit',
    });
  } catch {
    // Fallback to PowerShell Compress-Archive if 7z is not on PATH
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${portableRoot}' -DestinationPath '${zipPath}' -Force`,
      ],
      { stdio: 'inherit' },
    );
  }

  console.log(`[portable] Portable package created at ${zipPath}`);
  return { portableRoot, zipPath };
};

if (require.main === module) {
  try {
    buildWindowsPortableLayout(process.argv[2] || DEFAULT_BUILD_DIR);
  } catch (err) {
    console.error(`ERROR: ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildIcoFromPngs,
  buildWindowsPortableLayout,
};
