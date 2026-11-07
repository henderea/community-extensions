import {
  ButtonRow,
  Form,
  InputRow,
  Section,
  SelectRow,
  type FormSectionElement,
} from '@paperback/types';

import { NHLanguages, NHSortOrders } from './helpers';

// ===== State =====

const DEFAULT_EXTRA_ARGS = '-lolicon -shotacon -yaoi';

function firstString(key: string, fallback: string): string {
  const stored = Application.getState(key) as unknown;
  if(Array.isArray(stored)) { return typeof stored[0] === 'string' ? stored[0] : fallback; }
  return typeof stored === 'string' ? stored : fallback;
}

export const getLanguage = (): string => firstString('languages', NHLanguages.getDefault()[0] ?? '');
export const setLanguage = (v: string): void => Application.setState(v, 'languages');
export const getSortOrder = (): string => firstString('sort_order', NHSortOrders.getDefault()[0] ?? 'popular');
export const setSortOrder = (v: string): void => Application.setState(v, 'sort_order');
export const getExtraArgs = (): string => {
  const stored = Application.getState('extra_args') as unknown;
  return typeof stored === 'string' ? stored : DEFAULT_EXTRA_ARGS;
};
export const setExtraArgs = (v: string): void => Application.setState(v, 'extra_args');

export function resetSettings(): void {
  for(const key of ['languages', 'sort_order', 'extra_args']) {
    Application.setState(undefined, key);
  }
}

// The language and extra-argument part of every search query.
export function getQuerySuffix(): string {
  const lang = getLanguage();
  const language = lang === '' ? '""' : `language:${lang}`;
  return `${language} ${getExtraArgs()}`.trim();
}

// ===== Form =====

export class NHentaiSettingsForm extends Form {
  private extraArgs: string;

  constructor() {
    super();
    this.extraArgs = getExtraArgs();
  }

  override getSections(): FormSectionElement<unknown>[] {
    const language = getLanguage();
    const sortOrder = getSortOrder();
    return [
      Section(
        {
          id: 'content',
          header: 'Content Settings',
          footer:
            'Tags with a space in it, need to be replace with a "-"\nExample: "-big breasts" will be "-big-breasts"\nTo exclude tags add the "-" in front, to include add the "+".',
        },
        [
          SelectRow('languages', {
            title: 'Language',
            subtitle: NHLanguages.getName(language),
            value: [language],
            minItemCount: 1,
            maxItemCount: 1,
            options: NHLanguages.getNHCodeList().map((id) => ({ id, title: NHLanguages.getName(id) })),
            onValueChange: Application.Selector(this as NHentaiSettingsForm, 'handleLanguageChange'),
          }),
          SelectRow('sort_order', {
            title: 'Default search sort order',
            subtitle: NHSortOrders.getName(sortOrder),
            value: [sortOrder],
            minItemCount: 1,
            maxItemCount: 1,
            options: NHSortOrders.getNHCodeList().map((id) => ({ id, title: NHSortOrders.getName(id) })),
            onValueChange: Application.Selector(this as NHentaiSettingsForm, 'handleSortOrderChange'),
          }),
          InputRow('extra_args', {
            title: 'Additional arguments',
            value: this.extraArgs,
            onValueChange: Application.Selector(this as NHentaiSettingsForm, 'handleExtraArgsChange'),
          }),
        ],
      ),
      Section('reset', [
        ButtonRow('reset', {
          title: 'Reset to Default',
          onSelect: Application.Selector(this as NHentaiSettingsForm, 'handleReset'),
        }),
      ]),
    ];
  }

  async handleLanguageChange(value: string[]): Promise<void> {
    setLanguage(value[0] ?? '');
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleSortOrderChange(value: string[]): Promise<void> {
    setSortOrder(value[0] ?? NHSortOrders.getDefault()[0] ?? 'popular');
    this.reloadForm();
  }

  async handleExtraArgsChange(value: string): Promise<void> {
    this.extraArgs = value;
    setExtraArgs(value);
    Application.invalidateDiscoverSections();
  }

  async handleReset(): Promise<void> {
    resetSettings();
    this.extraArgs = getExtraArgs();
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}
