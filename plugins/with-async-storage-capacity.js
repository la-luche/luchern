const { withGradleProperties } = require('expo/config-plugins');

// Guest profiles and recording indexes must remain durable through a large
// offline event. AsyncStorage's Android default is only 6 MiB; keep individual
// guest chunks small and give the database enough total capacity for the
// tested 1,200-profile adversarial case.
module.exports = function withAsyncStorageCapacity(config) {
  return withGradleProperties(config, (gradleConfig) => {
    const key = 'AsyncStorage_db_size_in_MB';
    const existing = gradleConfig.modResults.find((item) => item.type === 'property' && item.key === key);
    if (existing) existing.value = '50';
    else gradleConfig.modResults.push({ type: 'property', key, value: '50' });
    return gradleConfig;
  });
};
