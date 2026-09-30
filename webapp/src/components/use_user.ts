// Copyright (c) 2026-present Antimatter contributors.
// See LICENSE.txt for license information.

import {useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import type {Dispatch} from 'redux';

import type {GlobalState} from '@mattermost/types/store';

import {UserTypes} from 'mattermost-redux/action_types';
import {Client4} from 'mattermost-redux/client';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {getUser} from 'mattermost-redux/selectors/entities/users';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

import {logError} from '../actions';

export function profileImageURL(userId: string, lastPictureUpdate = 0) {
    return `${window.basename || ''}/api/v4/users/${userId}/image?_=${lastPictureUpdate}`;
}

// Missing profiles are loaded in batches. (mattermost-redux's getMissingProfilesByIds would pull
// most of mattermost-redux into the bundle.)
const pendingUserIds = new Set<string>();
const requestedUserIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function loadMissingProfile(dispatch: Dispatch, userId: string) {
    if (requestedUserIds.has(userId)) {
        return;
    }
    requestedUserIds.add(userId);
    pendingUserIds.add(userId);

    if (flushTimer) {
        return;
    }
    flushTimer = setTimeout(async () => {
        flushTimer = null;
        const userIds = [...pendingUserIds];
        pendingUserIds.clear();
        try {
            const profiles = await Client4.getProfilesByIds(userIds);
            dispatch({type: UserTypes.RECEIVED_PROFILES_LIST, data: profiles});
        } catch (err) {
            logError('failed to load profiles', err);
            for (const id of userIds) {
                requestedUserIds.delete(id);
            }
        }
    }, 50);
}

// useUser returns the display name and picture of a user, loading their profile if needed.
export function useUser(userId: string) {
    const dispatch = useDispatch();
    const user = useSelector((state: GlobalState) => getUser(state, userId));
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);

    useEffect(() => {
        if (!user) {
            loadMissingProfile(dispatch, userId);
        }
    }, [dispatch, user, userId]);

    return {
        displayName: user ? displayUsername(user, nameDisplay) : '',
        imageURL: profileImageURL(userId, user?.last_picture_update),
    };
}
