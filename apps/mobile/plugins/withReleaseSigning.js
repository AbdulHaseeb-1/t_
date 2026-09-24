// Signs release builds with your own upload key when one is configured, so
// `expo prebuild --clean` never loses it. Configure in ~/.gradle/gradle.properties
// (never in the repo):
//   ASKDATA_UPLOAD_STORE_FILE=/abs/path/askdata-release.keystore
//   ASKDATA_UPLOAD_STORE_PASSWORD=...
//   ASKDATA_UPLOAD_KEY_ALIAS=askdata
//   ASKDATA_UPLOAD_KEY_PASSWORD=...
// Without them the release build falls back to the debug key (installable, not publishable).
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_CONFIG = `
        release {
            if (project.hasProperty('ASKDATA_UPLOAD_STORE_FILE')) {
                storeFile file(ASKDATA_UPLOAD_STORE_FILE)
                storePassword ASKDATA_UPLOAD_STORE_PASSWORD
                keyAlias ASKDATA_UPLOAD_KEY_ALIAS
                keyPassword ASKDATA_UPLOAD_KEY_PASSWORD
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('ASKDATA_UPLOAD_STORE_FILE')) return cfg;
    src = src.replace(/signingConfigs\s*\{/, (m) => `${m}${RELEASE_CONFIG}`);
    src = src.replace(
      /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig project.hasProperty('ASKDATA_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
    );
    cfg.modResults.contents = src;
    return cfg;
  });
};
