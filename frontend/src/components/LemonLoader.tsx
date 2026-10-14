/**
 * Reusable Lemon Mandi loading indicator — small lemon artwork + light motion.
 * Replaces ActivityIndicator for genuine loading states only.
 */
import { useEffect } from "react";
import { AccessibilityInfo, Image, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const LEMON = require("../../assets/images/lemon-loader.png");

export type LemonLoaderSize = "small" | "medium" | "large";

const SIZE_PX: Record<LemonLoaderSize, number> = {
  small: 22,
  medium: 36,
  large: 52,
};

type Props = {
  size?: LemonLoaderSize;
  /** Accessibility label for screen readers */
  label?: string;
  /** Full-screen centered overlay host */
  fullScreen?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function LemonLoader({
  size = "medium",
  label = "Loading",
  fullScreen = false,
  style,
  testID = "lemon-loader",
}: Props) {
  const px = SIZE_PX[size] ?? SIZE_PX.medium;
  const progress = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    let reduceMotion = false;

    const start = () => {
      if (cancelled || reduceMotion) {
        progress.value = 0;
        return;
      }
      progress.value = 0;
      progress.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      );
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        reduceMotion = !!v;
        start();
      })
      .catch(() => start());

    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v: boolean) => {
      reduceMotion = !!v;
      cancelAnimation(progress);
      start();
    });

    return () => {
      cancelled = true;
      cancelAnimation(progress);
      try {
        (sub as { remove?: () => void } | undefined)?.remove?.();
      } catch {
        /* ignore */
      }
    };
  }, [progress]);

  const animStyle = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      transform: [
        { translateY: -4 + t * 8 },
        { rotate: `${-8 + t * 16}deg` },
        { scale: 0.94 + t * 0.1 },
      ],
    };
  });

  const body = (
    <View
      style={[styles.box, { width: px + 8, height: px + 8 }, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <Animated.View style={animStyle}>
        <Image
          source={LEMON}
          style={{ width: px, height: px }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
    </View>
  );

  if (fullScreen) {
    return (
      <View style={styles.full} testID={`${testID}-fullscreen`}>
        {body}
      </View>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    justifyContent: "center",
  },
  full: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 120,
  },
});
