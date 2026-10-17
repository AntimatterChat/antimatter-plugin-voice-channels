// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {currentUserId, makeState} from '../tests/utils';

import {messages} from './components/messages';
import {intlFor} from './intl';
import {translationsFor} from './translations';

jest.mock('./translations', () => ({
    translationsFor: jest.fn(() => ({})),
}));

const mockedTranslationsFor = translationsFor as jest.MockedFunction<typeof translationsFor>;

describe('intlFor', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test("formats in the signed-in person's language", () => {
        mockedTranslationsFor.mockReturnValue({'voice_channels.settings.tab': 'Vocal'});
        const intl = intlFor(makeState({users: [{id: currentUserId, username: 'alice', locale: 'fr'} as never]}));

        expect(mockedTranslationsFor).toHaveBeenCalledWith('fr');
        expect(intl.locale).toBe('fr');
        expect(intl.formatMessage(messages.settingsTab)).toBe('Vocal');
    });

    test('falls back to English, quietly, for a string a language lacks', () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        const intl = intlFor(makeState());

        expect(intl.formatMessage(messages.settingsOff)).toBe('Regular channel');
        expect(error).not.toHaveBeenCalled();
        error.mockRestore();
    });
});
