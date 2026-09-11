"use client"

import { useState } from "react"
import Link from "next/link"
import {
  FileText,
  Upload,
  Copy,
  Check,
  Sparkles,
  Layers,
  ArrowRight,
  Send,
  Building2,
  Globe,
  ShoppingBag,
  ExternalLink,
  ShieldCheck,
  FolderPlus,
} from "lucide-react"

import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function AdminIntakePage() {
  const [copiedEmail, setCopiedEmail] = useState(false)
  const [copiedBrief, setCopiedBrief] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [activeTab, setActiveTab] = useState<"response" | "brief" | "prototype">("response")
  const [workspaceCreated, setWorkspaceCreated] = useState(false)

  // Extracted Client Data State
  const [clientData, setClientData] = useState({
    name: "Martin Aranda-Cardenas",
    company: "The Aranda Group Inc. dba \"La Michoácana Plus\"",
    email: "Lmplus69@Lmplusmke.com",
    phone: "(414) 736-9166",
    address: "3142 S 13th St, Milwaukee, WI 53215",
    currentDomain: "lmplusmke.com",
    notes: "Currently on Wix. Wants custom website overhaul, B2B wholesale distribution portal for centralized production, and permitting guidance for 3142 S 13th St building development.",
    scopeWebsite: true,
    scopeApp: true,
    scopePermitting: true,
  })

  // Generated Response Email
  const generatedEmail = `Subject: Re: Great meeting you last night! - Next Steps & Vision Proposal for La Michoacana PLUS

Hi Martin,

It was great connecting with you again! I really appreciate you sharing more details about La Michoacana PLUS and your vision for the business.

Based on our conversation, here is how we can partner up to bring this vision to life across your immediate and long-term goals:

1. Modern Web & Brand Overhaul (Replacing Wix):
   We’ll build a custom, high-converting digital experience for lmplusmke.com that highlights your menu, locations, story, and vibrant brand image far beyond what Wix can offer.

2. B2B Wholesale & Franchise Hub:
   To support centralizing your production and launching wholesale/franchising, we’ll incorporate a dedicated portal for wholesale buyers, store location inquiries, and prospective franchise partners.

3. Real Estate & City Permitting Guidance:
   On the building side (3142 S 13th St expansion/production facility), I’m already coordinating with our commercial development and permitting contacts to help evaluate the space and smooth out the city permitting process.

Next Step:
I am currently setting up an interactive prototype preview for you in our client portal (clients.readyaimgo.com). I will send over your access link shortly so you can see and test the concept live before we finalize everything.

Looking forward to building something big together!

Best regards,

Ezra Haugabrooks
ReadyAimGo / PaynePros
(404) 973-9860
haugabr2@uwm.edu`

  const generatedBrief = `# Client Brief: La Michoacana PLUS

## Client Metadata
- **Contact**: ${clientData.name} (${clientData.company})
- **Email**: ${clientData.email} | Phone: ${clientData.phone}
- **Location**: ${clientData.address}
- **Domain**: ${clientData.currentDomain} (Wix Upgrade)

## Target Scope
- [x] Custom Web Overhaul (Replacing Wix)
- [x] B2B Wholesale & Franchise Portal
- [x] Real Estate & Permitting Advisory (3142 S 13th St)

## Milestones
1. Interactive Prototype Staging (Active)
2. Custom Web Launch ($3,500 - $1,750 Deposit)
3. B2B Wholesale & Franchise Engine ($4,500)`

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(generatedEmail)
    setCopiedEmail(true)
    setTimeout(() => setCopiedEmail(false), 2000)
  }

  const handleCopyBrief = () => {
    navigator.clipboard.writeText(generatedBrief)
    setCopiedBrief(true)
    setTimeout(() => setCopiedBrief(false), 2000)
  }

  const handleRegisterWorkspace = () => {
    setWorkspaceCreated(true)
  }

  return (
    <AppShell
      eyebrow="Admin"
      title="Client Intake & AI Provisioner"
      description="Upload client conversation PDFs, extract scope, generate responses, and provision local repos + client portal workspaces."
      nav={[
        { href: "/dashboard", label: "Workspaces" },
        { href: "/admin/workspaces", label: "Admin · Workspaces" },
        { href: "/admin/contracts", label: "Admin · Contracts" },
        { href: "/admin/intake", label: "Admin · Intake", active: true },
      ]}
    >
      <div className="space-y-8 p-6 max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="accent" className="bg-primary/10 text-primary border-primary/20">
                ReadyAimGo Admin
              </Badge>
              <Badge variant="secondary">Intake & Prototype Engine</Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Client Intake & AI Provisioner</h1>
            <p className="text-muted-foreground">
              Upload client conversation PDFs, extract scope, generate responses, and provision local repos + client portal workspaces.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" asChild>
              <Link href="/admin/workspaces">
                <FolderPlus className="w-4 h-4 mr-2" />
                Manage Workspaces
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Upload & Context Extraction */}
          <div className="lg:col-span-5 space-y-6">
            <Card className="border-primary/20 bg-card/60 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="w-5 h-5 text-primary" />
                  1. Conversation PDF Upload
                </CardTitle>
                <CardDescription>
                  Upload Outlook/Gmail conversation PDF or paste raw email thread.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-2 border-dashed border-muted-foreground/30 hover:border-primary rounded-xl p-6 text-center cursor-pointer transition-colors bg-muted/20">
                  <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <p className="font-semibold text-sm">Drag & drop client email PDF here</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports Outlook exports, PDFs, or TXT</p>
                  <Button size="sm" variant="secondary" className="mt-4">
                    Select File
                  </Button>
                </div>

                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-muted"></div>
                  <span className="flex-shrink mx-4 text-xs text-muted-foreground uppercase font-semibold">Loaded Active Client</span>
                  <div className="flex-grow border-t border-muted"></div>
                </div>

                {/* Sample Active Client Details */}
                <div className="bg-muted/40 p-4 rounded-xl space-y-3 text-sm border border-border">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-foreground">{clientData.name}</h4>
                      <p className="text-xs text-muted-foreground">{clientData.company}</p>
                    </div>
                    <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Active Sample</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Domain:</span>{" "}
                      <span className="font-mono text-foreground">{clientData.currentDomain}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Phone:</span>{" "}
                      <span className="text-foreground">{clientData.phone}</span>
                    </div>
                  </div>
                </div>

                {/* Scope Selection */}
                <div className="space-y-2 pt-2">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Project Scope Tags</label>
                  <div className="grid grid-cols-1 gap-2">
                    <label className="flex items-center gap-3 p-3 rounded-lg border bg-background/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clientData.scopeWebsite}
                        onChange={(e) => setClientData({ ...clientData, scopeWebsite: e.target.checked })}
                        className="rounded border-primary text-primary focus:ring-primary"
                      />
                      <div>
                        <p className="font-medium text-xs">Website Overhaul (Replacing Wix)</p>
                        <p className="text-[11px] text-muted-foreground">Modern responsive brand storefront</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 p-3 rounded-lg border bg-background/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clientData.scopeApp}
                        onChange={(e) => setClientData({ ...clientData, scopeApp: e.target.checked })}
                        className="rounded border-primary text-primary focus:ring-primary"
                      />
                      <div>
                        <p className="font-medium text-xs">B2B Wholesale & Franchise Hub</p>
                        <p className="text-[11px] text-muted-foreground">Bulk order ordering & franchise applications</p>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 p-3 rounded-lg border bg-background/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clientData.scopePermitting}
                        onChange={(e) => setClientData({ ...clientData, scopePermitting: e.target.checked })}
                        className="rounded border-primary text-primary focus:ring-primary"
                      />
                      <div>
                        <p className="font-medium text-xs">Real Estate & Permitting Advisory</p>
                        <p className="text-[11px] text-muted-foreground">3142 S 13th St development & city permits</p>
                      </div>
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Generated Deliverables & Portal Integration */}
          <div className="lg:col-span-7 space-y-6">
            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-amber-500" />
                    <CardTitle className="text-xl">2. AI Generated Output & Workspace Provisioning</CardTitle>
                  </div>
                  {workspaceCreated ? (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 py-1">
                      <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Workspace Registered
                    </Badge>
                  ) : (
                    <Button size="sm" onClick={handleRegisterWorkspace} className="bg-primary text-primary-foreground font-semibold">
                      <FolderPlus className="w-4 h-4 mr-2" />
                      Provision Workspace
                    </Button>
                  )}
                </div>
                <CardDescription>
                  Review generated email, project briefs, and prototype links.
                </CardDescription>

                {/* Sub Navigation Tabs */}
                <div className="flex gap-2 border-b pt-4">
                  <button
                    onClick={() => setActiveTab("response")}
                    className={`pb-2 px-3 text-sm font-semibold border-b-2 transition-colors ${
                      activeTab === "response"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Client Response Email
                  </button>
                  <button
                    onClick={() => setActiveTab("brief")}
                    className={`pb-2 px-3 text-sm font-semibold border-b-2 transition-colors ${
                      activeTab === "brief"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Brief & AGENTS.md
                  </button>
                  <button
                    onClick={() => setActiveTab("prototype")}
                    className={`pb-2 px-3 text-sm font-semibold border-b-2 transition-colors ${
                      activeTab === "prototype"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Prototype Staging
                  </button>
                </div>
              </CardHeader>

              <CardContent className="pt-4">
                {activeTab === "response" && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-muted/30 p-3 rounded-lg border">
                      <span className="text-xs font-semibold text-muted-foreground">Ready to Copy & Paste to Martin</span>
                      <Button size="sm" variant="outline" onClick={handleCopyEmail}>
                        {copiedEmail ? (
                          <>
                            <Check className="w-4 h-4 mr-2 text-emerald-500" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-2" />
                            Copy Response Email
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="bg-muted/50 p-4 rounded-xl text-xs font-sans whitespace-pre-wrap leading-relaxed border max-h-[400px] overflow-y-auto">
                      {generatedEmail}
                    </pre>
                  </div>
                )}

                {activeTab === "brief" && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-muted/30 p-3 rounded-lg border">
                      <span className="text-xs font-semibold text-muted-foreground">Local Repo Files (CLIENT_BRIEF.md & AGENTS.md)</span>
                      <Button size="sm" variant="outline" onClick={handleCopyBrief}>
                        {copiedBrief ? (
                          <>
                            <Check className="w-4 h-4 mr-2 text-emerald-500" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-2" />
                            Copy Markdown Brief
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="bg-muted/50 p-4 rounded-xl text-xs font-mono whitespace-pre-wrap leading-relaxed border max-h-[400px] overflow-y-auto">
                      {generatedBrief}
                    </pre>
                  </div>
                )}

                {activeTab === "prototype" && (
                  <div className="space-y-4">
                    <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl space-y-2">
                      <div className="flex justify-between items-center">
                        <h4 className="font-bold text-emerald-400 text-sm">Local Interactive Prototype Online</h4>
                        <Badge className="bg-emerald-500/20 text-emerald-300 border-none">Ready</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Located at <code className="text-foreground bg-muted px-1.5 py-0.5 rounded">/Users/ehauga/Desktop/local dev/lamichoacanaplus/index.html</code>
                      </p>
                      <div className="pt-2 flex gap-3">
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold" asChild>
                          <Link href="/workspace/lamichoacanaplus">
                            View Client Portal View <ArrowRight className="w-4 h-4 ml-2" />
                          </Link>
                        </Button>
                      </div>
                    </div>

                    <div className="border rounded-xl p-4 bg-muted/20 space-y-3">
                      <h4 className="font-semibold text-xs text-muted-foreground uppercase">Prototype Feature Scope Included</h4>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="flex items-center gap-2 p-2 bg-background rounded-lg border">
                          <Globe className="w-4 h-4 text-primary" />
                          <span>Custom Ice Cream Storefront</span>
                        </div>
                        <div className="flex items-center gap-2 p-2 bg-background rounded-lg border">
                          <ShoppingBag className="w-4 h-4 text-amber-500" />
                          <span>B2B Wholesale Ordering</span>
                        </div>
                        <div className="flex items-center gap-2 p-2 bg-background rounded-lg border">
                          <Building2 className="w-4 h-4 text-cyan-500" />
                          <span>City Permitting Dashboard</span>
                        </div>
                        <div className="flex items-center gap-2 p-2 bg-background rounded-lg border">
                          <ShieldCheck className="w-4 h-4 text-emerald-500" />
                          <span>Deposit Payment Authorization</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
