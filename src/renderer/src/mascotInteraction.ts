// SPDX-License-Identifier: MIT
import type {InjectionKey,Ref} from 'vue'

/** Ephemeral header interaction priority; it never changes saved motion preferences. */
export const MASCOT_INTERACTIVE:InjectionKey<Readonly<Ref<boolean>>>=Symbol('mascotInteractive')
