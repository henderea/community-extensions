// Settings for the paperback-mdchecker server (~/projects/paperback-mdchecker).

import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  type FormSectionElement,
} from '@paperback/types';

import { getCheckerCollections, getCheckerIsAdminFromServer } from '../../../services/checker';
import {
  getCheckerBaseUrl,
  getCheckerIsAdmin,
  getCheckerUser,
  isCheckerEnabled,
  setCheckerBaseUrl,
  setCheckerIsAdmin,
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
            'When both values are set, update checks skip manga the server reports as current, and library collections come from the server instead of MangaDex reading statuses. Test Connection also checks whether the user is a server admin, which unlocks the Potential Manga home section.',
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
          LabelRow('checker_admin', {
            title: 'Admin',
            value: getCheckerIsAdmin() ? 'Yes' : 'No (run Test Connection)',
            isHidden: !isCheckerEnabled(),
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
    const wasAdmin = getCheckerIsAdmin();
    setCheckerBaseUrl(value);
    if(wasAdmin !== getCheckerIsAdmin()) { Application.invalidateDiscoverSections(); }
    this.baseUrl = getCheckerBaseUrl();
    this.statusMessage = '';
    this.reloadForm();
  }

  async handleUserChange(value: string): Promise<void> {
    const wasAdmin = getCheckerIsAdmin();
    setCheckerUser(value);
    if(wasAdmin !== getCheckerIsAdmin()) { Application.invalidateDiscoverSections(); }
    this.user = getCheckerUser();
    this.statusMessage = '';
    this.reloadForm();
  }

  async handleTest(): Promise<void> {
    const wasAdmin = getCheckerIsAdmin();
    try {
      const collections = await getCheckerCollections();
      this.statusMessage = `OK: ${collections.length} collection${collections.length === 1 ? '' : 's'}`;
      try {
        const isAdmin = await getCheckerIsAdminFromServer();
        setCheckerIsAdmin(isAdmin);
        if(isAdmin) { this.statusMessage += ', admin'; }
      } catch(err) {
        // Older servers have no /user-info; treat that as not an admin.
        setCheckerIsAdmin(false);
        this.statusMessage += ` (admin check failed: ${err instanceof Error ? err.message : String(err)})`;
      }
    } catch(err) {
      setCheckerIsAdmin(false);
      this.statusMessage = err instanceof Error ? err.message : String(err);
    }
    if(wasAdmin !== getCheckerIsAdmin()) { Application.invalidateDiscoverSections(); }
    this.reloadForm();
  }
}
