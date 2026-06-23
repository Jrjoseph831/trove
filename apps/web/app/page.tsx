import { Terminal } from "@/components/Terminal";
import { TroveProvider } from "@/lib/trove";

export default function Home() {
  return (
    <TroveProvider>
      <Terminal />
    </TroveProvider>
  );
}
