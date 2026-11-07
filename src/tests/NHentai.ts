import { type TestLogger } from '@paperback/types';

import { NHentai } from '../NHentai/main.js';
import sourceInfo from '../NHentai/pbconfig.js';
import { TestSuite, registerDefaultTests } from './suite.js';

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite('NHentai tests', logger);
  // Uses the first search result, since individual galleries can disappear.
  registerDefaultTests(suite, NHentai, sourceInfo);

  await suite.run();
}
