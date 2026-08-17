const fs = require('node:fs');
const path = require('node:path');

const reactNativeRoot = path.dirname(require.resolve('react-native/package.json'));
const replacement =
  '    // iOS 26 may deliver an update/cancel after UIKit resets this registry.\n' +
  '    // The guard below already implements React Native\'s safe release behavior.\n';

const handlers = [
  {
    name: 'RCTSurfaceTouchHandler',
    file: 'RCTSurfaceTouchHandler.mm',
    registry: '_activeTouches',
  },
  {
    name: 'RCTSurfacePointerHandler',
    file: 'RCTSurfacePointerHandler.mm',
    registry: '_activePointers',
  },
];

for (const handler of handlers) {
  const handlerPath = path.join(reactNativeRoot, 'React', 'Fabric', handler.file);
  const assertion =
    `    RCTAssert(iterator != ${handler.registry}.end(), ` +
    '@"Inconsistency between local and UIKit touch registries");\n';
  const source = fs.readFileSync(handlerPath, 'utf8');
  const assertionCount = source.split(assertion).length - 1;
  const replacementCount = source.split(replacement).length - 1;

  if (assertionCount === 3) {
    fs.writeFileSync(handlerPath, source.replaceAll(assertion, replacement));
    console.log(`Patched ${handler.name} iOS 26 unknown-touch assertions.`);
  } else if (assertionCount === 0 && replacementCount === 3) {
    console.log(`${handler.name} iOS 26 unknown-touch assertions already patched.`);
  } else {
    throw new Error(
      `Unexpected ${handler.name} shape: found ${assertionCount} assertions and ` +
        `${replacementCount} patch markers. Review the React Native update before building.`,
    );
  }
}
