import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Building, Mail, Shield } from "lucide-react";
import { getUserRole, saveSession } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";

interface LoginPageProps {
  onLogin: (email: string, role: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  // no local OTP; server sends via email
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const normalizeCompanyEmail = (val: string) => {
    const raw = (val || "").trim().toLowerCase();
    return raw.includes("@") ? raw : `${raw}@premierenergies.com`;
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email) {
      setError("Please enter your email address");
      return;
    }

    const normal = normalizeCompanyEmail(email);
    try {
      const resp = await fetch(`/api/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normal }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.message || "Failed to send OTP");
      } else {
        setEmail(normal); // reflect normalized address in UI
        setStep("otp");
        toast({
          title: "OTP Sent",
          description: `We’ve emailed a 4-digit code to ${normal}`,
          variant: "default",
        });
      }
    } catch (err: any) {
      setError("Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!otp) {
      setError("Please enter the OTP");
      return;
    }

    try {
      const normal = normalizeCompanyEmail(email);
      const resp = await fetch(`/api/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normal, otp }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.message || "Invalid OTP. Please check and try again.");
        setLoading(false);
        return;
      }

      const role = await getUserRole(normal);
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 8); // 8 hour session

      await saveSession({
        email: normal,
        role,
        expiresAt: expiresAt.toISOString(),
      });

      toast({
        title: "Login Successful",
        description: `Welcome back! Logged in as ${role}`,
        variant: "default",
      });

      onLogin(normal, role);
    } catch (error) {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleChangeEmail = () => {
    setStep("email");
    setEmail("");
    setOtp("");
    setGeneratedOTP("");
    setError("");
  };

  const handleResendOTP = async () => {
    setError("");
    setOtp("");
    const normal = normalizeCompanyEmail(email);
    try {
      const resp = await fetch(`/api/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normal }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.message || "Failed to resend OTP");
      } else {
        toast({
          title: "OTP Sent",
          description: `We’ve re-sent the code to ${normal}`,
          variant: "default",
        });
      }
    } catch {
      setError("Failed to resend OTP");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <div className="bg-gradient-primary p-3 rounded-2xl shadow-medium">
              <Building className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">CCAS</h1>
          <p className="text-muted-foreground">Code Creation Approval System</p>
        </div>

        <Card className="bg-gradient-card shadow-medium border-0">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">
              {step === "email" ? "Sign In" : "Enter OTP"}
            </CardTitle>
            <CardDescription className="text-center">
              {step === "email"
                ? "Enter your email to receive an OTP"
                : `We've sent an OTP to ${email}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {step === "email" ? (
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      id="email"
                      type="text"
                      placeholder="Enter your company email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      disabled={loading}
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Generating OTP..." : "Generate OTP"}
                </Button>
              </form>
            ) : (
              <>
                <form onSubmit={handleOTPSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="otp">Enter OTP</Label>
                    <Input
                      id="otp"
                      type="text"
                      placeholder="Enter 4-digit OTP"
                      value={otp}
                      onChange={(e) =>
                        setOtp(
                          e.target.value.replace(/\D/g, "").substring(0, 4)
                        )
                      }
                      className="text-center text-lg tracking-widest"
                      disabled={loading}
                      maxLength={4}
                    />
                    <p className="text-xs text-muted-foreground">
                      We’ll append “@premierenergies.com” automatically if you
                      omit it.
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading || otp.length !== 4}
                  >
                    {loading ? "Verifying..." : "Verify OTP"}
                  </Button>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleChangeEmail}
                      className="flex-1"
                      disabled={loading}
                    >
                      Change Email
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleResendOTP}
                      className="flex-1"
                      disabled={loading}
                    >
                      Resend OTP
                    </Button>
                  </div>
                </form>
              </>
            )}
          </CardContent>
        </Card>

        <div className="text-center mt-6 text-sm text-muted-foreground">
          <p>Use your company email. An OTP will be emailed to you.</p>
        </div>
      </div>
    </div>
  );
}
