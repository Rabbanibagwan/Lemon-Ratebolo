import React from "react";
import { Platform, type StyleProp, type ViewStyle } from "react-native";
import {
  KeyboardAwareScrollView,
  KeyboardAvoidingView,
  type KeyboardAwareScrollViewProps,
} from "react-native-keyboard-controller";

/** Shared offsets so focused fields stay clear of the Android IME. */
export const KEYBOARD_FORM_BOTTOM_OFFSET = Platform.OS === "android" ? 32 : 12;
export const KEYBOARD_FORM_EXTRA_SPACE = Platform.OS === "android" ? 24 : 0;

type ScrollProps = KeyboardAwareScrollViewProps & {
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
};

/**
 * Full-screen form scroller — use on Sign In, Create Account, and other pages.
 * Keeps the focused field (and nearby actions) above the keyboard on Android + iOS.
 */
export function KeyboardFormScroll({
  children,
  bottomOffset = KEYBOARD_FORM_BOTTOM_OFFSET,
  extraKeyboardSpace = KEYBOARD_FORM_EXTRA_SPACE,
  keyboardShouldPersistTaps = "handled",
  keyboardDismissMode = "interactive",
  showsVerticalScrollIndicator = false,
  style,
  ...rest
}: ScrollProps) {
  return (
    <KeyboardAwareScrollView
      style={[{ flex: 1 }, style]}
      bottomOffset={bottomOffset}
      extraKeyboardSpace={extraKeyboardSpace}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={keyboardDismissMode}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      {...rest}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

type AvoidProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  enabled?: boolean;
  keyboardVerticalOffset?: number;
  behavior?: "padding" | "height" | "translate-with-padding";
};

/**
 * Modal / bottom-sheet wrapper — lifts the sheet above the keyboard on both platforms.
 * Prefer this over RN's KeyboardAvoidingView (which often no-ops on Android).
 */
export function KeyboardFormAvoid({
  children,
  behavior = "padding",
  style,
  ...rest
}: AvoidProps) {
  return (
    <KeyboardAvoidingView behavior={behavior} style={[{ flex: 1 }, style]} {...rest}>
      {children}
    </KeyboardAvoidingView>
  );
}
