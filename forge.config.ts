//
// This is the Electron Forge build/package configuration that defines
// makers, Vite entry points, and fuse hardening for packaged app output.
//
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const PACKAGED_APPLICATION_ICON_BASE_PATH = path.resolve(
  __dirname,
  'assets/icons/icon',
);
const WINDOWS_INSTALLER_SETUP_ICON_PATH = path.resolve(
  __dirname,
  'assets/icons/icon.ico',
);
const LINUX_PACKAGE_ICON_PATH = path.resolve(
  __dirname,
  'assets/icons/icon.png',
);
const LINUX_RUNTIME_WINDOW_ICON_RESOURCE_PATH = path.resolve(
  __dirname,
  'assets/icons/icon.png',
);

const config: ForgeConfig = {
  packagerConfig: {
    // node-pty's macOS implementation executes a helper binary and loads
    // native `.node` bindings at runtime, both of which must live outside
    // `app.asar` to remain executable/loadable in packaged apps.
    asar: {
      unpack: '**/{*.node,spawn-helper}',
    },
    // Use per-platform icon formats during package generation:
    // - macOS: `icon.icns`
    // - Windows: `icon.ico`
    icon: PACKAGED_APPLICATION_ICON_BASE_PATH,
    // Linux runtime window icons are provided via BrowserWindow `icon`.
    // Include the PNG in the packaged resources directory for that lookup.
    extraResource: [LINUX_RUNTIME_WINDOW_ICON_RESOURCE_PATH],
    // The Vite plugin normally packages only the generated `/.vite` output.
    // Kale additionally requires:
    // - `/prompts` for terminal startup prompt templates
    // - `/node_modules` because main-process externals (`node-pty`, `ws`)
    //   are resolved at runtime from packaged dependencies
    ignore: (file: string) => {
      if (!file) {
        return false;
      }

      // Electron Packager passes project-relative paths prefixed with `/`.
      const isViteBuildOutput = file.startsWith('/.vite');
      const isRuntimePromptAsset = file.startsWith('/prompts');
      // Main-process bundles intentionally externalize native/runtime modules
      // (for example `node-pty` and `ws`), so packaged apps must retain
      // production node_modules for those runtime `require()` calls.
      const isRuntimeNodeModuleDependency = file.startsWith('/node_modules');
      return (
        !isViteBuildOutput &&
        !isRuntimePromptAsset &&
        !isRuntimeNodeModuleDependency
      );
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      setupIcon: WINDOWS_INSTALLER_SETUP_ICON_PATH,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({
      options: {
        icon: LINUX_PACKAGE_ICON_PATH,
      },
    }),
    new MakerDeb({
      options: {
        icon: LINUX_PACKAGE_ICON_PATH,
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
