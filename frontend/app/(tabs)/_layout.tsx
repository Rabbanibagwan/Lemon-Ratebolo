import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect } from "react";
import { useAuth } from "@/src/context/AuthContext";
import { colors, font } from "@/src/theme";

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const router = useRouter();
  const isOwner = session?.role === "owner";

  // Counter role: force to Pattis tab if they land elsewhere restricted (best effort).
  useEffect(() => {
    // No-op; tab restriction is enforced by hiding tabs below.
  }, [session]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 2,
          borderTopColor: colors.borderStrong,
          height: 62 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom || (Platform.OS === "ios" ? 4 : 8),
        },
        tabBarLabelStyle: {
          fontFamily: font.display,
          fontWeight: "800",
          letterSpacing: 0.6,
          fontSize: 10,
          textTransform: "uppercase",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="auction"
        options={{
          title: "Auction",
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color} size={size} />,
          href: isOwner ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "Patti Details",
          tabBarIcon: ({ color, size }) => <Ionicons name="document-text-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="directory"
        options={{
          title: "People",
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" color={color} size={size} />,
          href: isOwner ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Reports",
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" color={color} size={size} />,
          href: isOwner ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
