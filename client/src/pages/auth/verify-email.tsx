import { useState, useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Loader2, ArrowLeft, Mail } from "lucide-react";

export default function VerifyEmail() {
  const [, navigate] = useLocation();
  const searchParams = useSearch();
  const { toast } = useToast();

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    const verifyEmailToken = async () => {
      const urlParams = new URLSearchParams(searchParams);
      const token = urlParams.get("token");

      if (!token) {
        setStatus("error");
        setMessage("Invalid verification link.");
        return;
      }

      try {
        const resp = await fetch(`/api/auth/verify-email?token=${token}`);
        if (resp.ok) {
          setStatus("success");
          setMessage("Your email has been verified successfully!");
          toast({ title: "Email verified!", description: "You can now sign in to your account." });

          // Redirect to login after 3s
          setTimeout(() => navigate("/login?verified=true"), 3000);
        } else {
          const data = await resp.json().catch(() => ({}));
          // Backend returns { message: "Invalid or expired verification token" }
          setStatus("error");
          setMessage(data.message || "Verification failed.");
        }
      } catch {
        setStatus("error");
        setMessage("Something went wrong. Please try again.");
      }
    };

    verifyEmailToken();
  }, [searchParams, navigate, toast]);

  const handleResend = async () => {
    if (!resendEmail) {
      toast({ variant: "destructive", title: "Email required", description: "Please enter your email address." });
      return;
    }
    setIsResending(true);
    try {
      const resp = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        toast({
          title: "Verification email sent",
          description: "Please check your inbox. The link is valid for 24 hours.",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Could not resend",
          description: data.message || "Please make sure the email is correct.",
        });
      }
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-lg shadow-md text-center">

        {/* Header */}
        <div>
          <Logo className="mx-auto" />
          <h2 className="mt-6 text-3xl font-bold font-serif text-gray-900">
            Email Verification
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Verification links are valid for <strong>24 hours</strong>.
          </p>
        </div>

        {/* Status Content */}
        <div className="space-y-6">
          {status === "loading" && (
            <div className="space-y-4">
              <Loader2 className="mx-auto h-16 w-16 animate-spin text-primary" />
              <p className="text-gray-600">Verifying your email address...</p>
            </div>
          )}

          {status === "success" && (
            <div className="space-y-4">
              <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
              <div className="space-y-2">
                <p className="text-lg font-medium text-green-700">{message}</p>
                <p className="text-sm text-gray-600">Redirecting to login page in a few seconds...</p>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="space-y-4">
              <XCircle className="mx-auto h-16 w-16 text-red-500" />
              <div className="space-y-2">
                <p className="text-lg font-medium text-red-700">{message}</p>
                <p className="text-sm text-gray-600">
                  If your link expired, you can resend a new verification email below.
                </p>
              </div>

              {/* Resend box */}
              <div className="text-left border rounded-lg p-4 bg-gray-50">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Resend verification email
                </label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="your@email.com"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                  />
                  <Button onClick={handleResend} disabled={isResending} className="whitespace-nowrap">
                    {isResending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                    Resend
                  </Button>
                </div>
                <p className="mt-2 text-xs text-gray-500">The new link will be valid for 24 hours.</p>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="space-y-4">
          {status === "success" && (
            <Link href="/login?verified=true">
              <Button className="w-full">Continue to Login</Button>
            </Link>
          )}

          {status === "error" && (
            <div className="space-y-3">
              <Link href="/login">
                <Button variant="outline" className="w-full">Back to Login</Button>
              </Link>
            </div>
          )}

          <Link href="/">
            <Button variant="outline" className="w-full flex items-center justify-center">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Website
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}