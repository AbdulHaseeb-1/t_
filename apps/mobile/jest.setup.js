jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Native keyboard tracking has no JS fallback in Jest: the library's own mock renders plain views.
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));
