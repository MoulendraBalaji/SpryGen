import React from "react";
import { View, Text, TextInput, Button } from "react-native";
import { notifListener } from "../services/notifListener";

export function QuickCapture() {
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    const sub = notifListener.onNotification((n) => {
      if (/assignment|due|deadline|submit/i.test(n.text)) {
        // forward to desktop over WebSocket pairing link
        console.log("Candidate task from", n.packageName, n.text);
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
      <Text style={{ fontSize: 20, marginBottom: 12 }}>Quick Capture</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="Note a task…"
        style={{ borderWidth: 1, borderColor: "#ccc", padding: 12, borderRadius: 12 }}
      />
      <Button title="Send to SPRYGEN" onPress={() => setDraft("")} />
    </View>
  );
}
