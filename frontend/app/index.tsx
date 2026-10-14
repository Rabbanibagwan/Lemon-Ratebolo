import { Redirect } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/src/context/AuthContext";
import { colors } from "@/src/theme";
import { LemonLoader } from "@/src/components/LemonLoader";

export default function Index() {
  const { loading, session } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <LemonLoader size="large" />
      </View>
    );
  }
  return <Redirect href={session ? "/(tabs)" : "/login"} />;
}
