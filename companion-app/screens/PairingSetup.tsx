import React, { useState } from "react";
import { View, Text, TextInput, Button, StyleSheet } from "react-native";
import { usePairing } from "../services/pairing";

export function PairingSetup() {
  const { paired, error, loading, pairWithHost } = usePairing();
  const [ip, setIp] = useState("192.168.1.100");
  const [pin, setPin] = useState("");

  const handlePair = () => {
    if (ip && pin) {
      pairWithHost(ip, pin);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pair with SPRYGEN Desktop</Text>
      <Text style={styles.subtitle}>Connect over your local Wi-Fi network</Text>

      {paired ? (
        <View style={styles.pairedBox}>
          <Text style={styles.pairedText}>✅ Successfully Paired with Desktop!</Text>
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>Desktop Local IP Address</Text>
          <TextInput
            value={ip}
            onChangeText={setIp}
            placeholder="e.g. 192.168.1.45"
            style={styles.input}
          />

          <Text style={styles.label}>6-Digit Desktop PIN</Text>
          <TextInput
            value={pin}
            onChangeText={setPin}
            placeholder="Enter 6-digit PIN"
            keyboardType="number-pad"
            maxLength={6}
            style={styles.input}
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          <Button
            title={loading ? "Pairing..." : "Connect to SPRYGEN"}
            onPress={handlePair}
            disabled={loading || pin.length < 6}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center", backgroundColor: "#f6f8fd" },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 6, color: "#1f2740" },
  subtitle: { fontSize: 13, color: "#667", marginBottom: 20 },
  form: { gap: 12 },
  label: { fontSize: 13, fontWeight: "600", color: "#334" },
  input: { borderWidth: 1, borderColor: "#ccd", padding: 12, borderRadius: 10, backgroundColor: "#fff" },
  errorText: { color: "#c13030", fontSize: 12, marginTop: 4 },
  pairedBox: { padding: 16, backgroundColor: "#e2f5e8", borderRadius: 12, alignItems: "center" },
  pairedText: { color: "#15602a", fontWeight: "bold" }
});
