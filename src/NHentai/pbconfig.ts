import { ContentRating, SourceIntents, type ExtensionInfo } from '@paperback/types';

export default {
  name: 'nhentai',
  description: 'Extension which pulls content from nHentai.',
  // Bump on every change. The 0.8 source ended at 4.1.3.
  version: '5.0.1',
  icon: 'icon.png',
  language: 'multi',
  contentRating: ContentRating.ADULT,
  capabilities: [
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
  ],
  badges: [{ label: '18+', textColor: '#000000', backgroundColor: '#f5c518' }],
  developers: [
    {
      name: 'henderea',
      github: 'https://github.com/henderea',
    },
    {
      name: 'NotMarek & Netsky',
      github: 'https://github.com/TheNetsky',
    },
  ],
} satisfies ExtensionInfo;
