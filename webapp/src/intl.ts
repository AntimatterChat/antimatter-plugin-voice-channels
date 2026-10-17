// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {createIntl, ReactIntlErrorCode, type IntlShape} from 'react-intl';

import type {GlobalState} from '@mattermost/types/store';

import {getCurrentUserLocale} from 'mattermost-redux/selectors/entities/i18n';

import {logError} from './actions';
import {translationsFor} from './translations';

// intlFor formats the app's strings outside React, in the signed-in person's language: for what the app gives the
// host as plain text when it registers (its channel settings tab). English is each message's defaultMessage.
export function intlFor(state: GlobalState): IntlShape {
    const locale = getCurrentUserLocale(state) || 'en';
    return createIntl({
        locale,
        defaultLocale: 'en',
        messages: translationsFor(locale),
        onError: (err) => {
            // English has no catalog of its own, and a language may not have every string yet.
            if (err.code !== ReactIntlErrorCode.MISSING_TRANSLATION) {
                logError('failed to format a string', err);
            }
        },
    });
}
