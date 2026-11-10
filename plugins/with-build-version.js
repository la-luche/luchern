const { withXcodeProject, withAppBuildGradle } = require('expo/config-plugins');

const phaseName = 'Verify Luche version';
const marker = '// Luche shared version guards';

function guardIos(project, version, buildNumber) {
  // Expo writes Info.plist versions but leaves Xcode's template build settings.
  // Keep both representations aligned before the native verification phase runs.
  if (version && buildNumber) {
    project.updateBuildProperty('MARKETING_VERSION', version);
    project.updateBuildProperty('CURRENT_PROJECT_VERSION', String(buildNumber));
  }
  const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
  if (Object.values(phases).some((phase) => phase?.name === `"${phaseName}"`)) return project;
  const { uuid } = project.getFirstTarget();
  project.addBuildPhase([], 'PBXShellScriptBuildPhase', phaseName, uuid, {
    shellPath: '/bin/sh',
    shellScript: '/bin/sh "$PROJECT_DIR/../scripts/check-ios-version.sh"',
    inputPaths: ['"$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)"'],
  });
  return project;
}

function guardAndroid(source) {
  if (source.includes(marker)) return source;
  return source + `
${marker}
tasks.register("verifyLucheVersion", Exec) {
    workingDir rootDir.parentFile
    commandLine "node", "scripts/build-version.cjs", "check"
}
preBuild.dependsOn("verifyLucheVersion")
tasks.matching { it.name == "packageDebug" || it.name == "packageRelease" }.configureEach {
    doLast {
        def artifacts = outputs.files.asFileTree.matching { include "**/*.apk" }.files
        if (artifacts.empty) throw new GradleException("No APK found for Luche version verification")
        artifacts.each { artifact ->
            exec {
                workingDir rootDir.parentFile
                commandLine "node", "scripts/verify-build.cjs", artifact.absolutePath
            }
        }
    }
}
`;
}

module.exports = function withBuildVersion(config) {
  config = withXcodeProject(config, (mod) => {
    mod.modResults = guardIos(mod.modResults, mod.version, mod.ios.buildNumber);
    return mod;
  });
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = guardAndroid(mod.modResults.contents);
    return mod;
  });
};
module.exports.guardIos = guardIos;
module.exports.guardAndroid = guardAndroid;
