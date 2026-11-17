/**
 * Official Lemon Mandi brand logo for sign-in (breathing zoom).
 * Uses the attached logo artwork — not a text approximation.
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

const LOGO = require("../../assets/images/lemon-mandi-logo.png");

type Props = {
  size?: number;
  animate?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function BrandLogo({
  size = 140,
  animate = true,
  style,
  testID = "brand-logo",
}: Props) {
  const scale = useSharedValue(1);

  useEffect(() => {
    let cancelled = false;
    let reduceMotion = false;

    const stop = () => {
      cancelAnimation(scale);
      scale.value = 1;
    };

    const start = () => {
      if (cancelled || !animate || reduceMotion) {
        stop();
        return;
      }
      scale.value = 0.95;
      scale.value = withRepeat(
        withSequence(
          withTiming(1.03, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.95, { duration: 1700, easing: Easing.inOut(Easing.sin) }),
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
      stop();
      start();
    });

    return () => {
      cancelled = true;
      stop();
      try {
        (sub as { remove?: () => void } | undefined)?.remove?.();
      } catch {
        /* ignore */
      }
    };
  }, [animate, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View
      style={[styles.wrap, { width: size, height: size }, style]}
      pointerEvents="none"
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel="Lemon Mandi"
    >
      <Animated.View style={[styles.inner, animStyle]}>
        <Image source={LOGO} style={styles.img} resizeMode="contain" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  inner: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  img: {
    width: "100%",
    height: "100%",
  },
});
