const { createEsmPreset } = require('jest-preset-angular/presets');
const preset = createEsmPreset({ tsconfig: '<rootDir>/tsconfig.spec.json' });
module.exports = {
  ...preset,
  setupFilesAfterEnv: ['<rootDir>/src/setup-tests.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  testEnvironmentOptions: {
    url: 'http://localhost:4200',
    customExportConditions: ['node', 'node-addons'],
  },
};
