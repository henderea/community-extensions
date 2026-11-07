// Settings for the paperback-mdchecker server (~/projects/paperback-mdchecker).

import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  type FormSectionElement,
} from '@paperback/types';

import { getCheckerCollections } from '../../../services/checker';
import {
  getCheckerBaseUrl,
  getCheckerUser,
  isCheckerEnabled,
  setCheckerBaseUrl,
  setCheckerUser,
} from '../../shared/state';

export class CheckerSettingsForm extends Form {
  private baseUrl: string;
  private user: string;
  private statusMessage: string = '';

  constructor() {
    super();
    this.baseUrl = getCheckerBaseUrl();
    this.user = getCheckerUser();
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: 'checker_settings',
          header: 'paperback-mdchecker',
          footer:
            'When both values are set, update checks skip manga the server reports as current, and library collections come from the server instead of MangaDex reading statuses.',
        },
        [
          InputRow('checker_base_url', {
            title: 'Base URL',
            value: this.baseUrl,
            onValueChange: Application.Selector(this as CheckerSettingsForm, 'handleBaseUrlChange'),
          }),
          InputRow('checker_user', {
            title: 'Username',
            value: this.user,
            onValueChange: Application.Selector(this as CheckerSettingsForm, 'handleUserChange'),
          }),
          LabelRow('checker_status', {
            title: 'Status',
            value: isCheckerEnabled() ? 'Enabled' : 'Disabled',
          }),
        ],
      ),
      Section('checker_test', [
        ButtonRow('checker_test_button', {
          title: 'Test Connection',
          onSelect: Application.Selector(this as CheckerSettingsForm, 'handleTest'),
          isHidden: !isCheckerEnabled(),
        }),
        LabelRow('checker_test_result', {
          title: this.statusMessage || ' ',
          isHidden: !this.statusMessage,
        }),
      ]),
    ];
  }

  async handleBaseUrlChange(value: string): Promise<void> {
    setCheckerBaseUrl(value);
    this.baseUrl = getCheckerBaseUrl();
    this.statusMessage = '';
    this.reloadForm();
  }

  async handleUserChange(value: string): Promise<void> {
    setCheckerUser(value);
    this.user = getCheckerUser();
    this.statusMessage = '';
    this.reloadForm();
  }

  async handleTest(): Promise<void> {
    try {
      const collections = await getCheckerCollections();
      this.statusMessage = `OK: ${collections.length} collection${collections.length === 1 ? '' : 's'}`;
    } catch(err) {
      this.statusMessage = err instanceof Error ? err.message : String(err);
    }
    this.reloadForm();
  }
}
