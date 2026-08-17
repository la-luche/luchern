const fs = require('node:fs');
const path = require('node:path');

const { withDangerousMod, withPodfileProperties } = require('@expo/config-plugins');

const postInstallCall = `    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )`;

const fmtPatch = `

    # BEGIN Luche Xcode 26 fmt workaround
    # fmt 11.0.2 fails its C++20 consteval checks under Xcode 26.4+ when
    # React Native is built from source. Remove this when React Native ships
    # a fmt release containing the upstream Apple Clang fix.
    fmt_base = File.join(installer.sandbox.pod_dir('fmt'), 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      content = File.read(fmt_base)
      patched = content.gsub(/^#\\s*define FMT_USE_CONSTEVAL 1$/, '#  define FMT_USE_CONSTEVAL 0')
      if patched != content
        File.chmod(0644, fmt_base)
        File.write(fmt_base, patched)
      end
    end
    # END Luche Xcode 26 fmt workaround`;

function withIos26TouchFix(config) {
  config = withPodfileProperties(config, (modConfig) => {
    modConfig.modResults['ios.buildReactNativeFromSource'] = 'true';
    return modConfig;
  });

  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      const source = fs.readFileSync(podfilePath, 'utf8');

      if (source.includes('# BEGIN Luche Xcode 26 fmt workaround')) {
        return modConfig;
      }
      if (!source.includes(postInstallCall)) {
        throw new Error(
          'Could not find Expo\'s react_native_post_install block while applying the Xcode 26 fmt fix.',
        );
      }

      fs.writeFileSync(podfilePath, source.replace(postInstallCall, postInstallCall + fmtPatch));
      return modConfig;
    },
  ]);
}

module.exports = withIos26TouchFix;
