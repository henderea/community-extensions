/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// The upstream "Optimized Updates" toggle and the skip filters / batch size
// that only applied to it are removed: paperback-mdchecker decides which manga
// get fetched during library updates.

import { Form, Section, ToggleRow, type FormSectionElement } from '@paperback/types';

import { getMetadataUpdater, setMetadataUpdater } from '../../shared/state';

export class UpdateFilterSettingsForm extends Form {
  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: 'update_settings',
          footer: "Affects how Paperback's library updates behave",
        },
        [
          ToggleRow('metadata_updater', {
            title: 'Auto-Update Metadata',
            subtitle: 'Refresh details on open but adds API calls',
            value: getMetadataUpdater(),
            onValueChange: Application.Selector(
              this as UpdateFilterSettingsForm,
              'handleMetadataUpdaterChange',
            ),
          }),
        ],
      ),
    ];
  }

  async handleMetadataUpdaterChange(value: boolean): Promise<void> {
    setMetadataUpdater(value);
  }
}
