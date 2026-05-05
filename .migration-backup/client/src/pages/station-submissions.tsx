import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle, X, Trash2, ExternalLink, Calendar, User, Globe, Music } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

export default function StationSubmissions() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['/api/station-submissions', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.append("status", statusFilter);
      
      const response = await fetch(`/api/station-submissions?${params}`);
      if (!response.ok) throw new Error('Failed to fetch station submissions');
      return response.json();
    }
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/station-submissions/${id}/approve`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Failed to approve submission');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/station-submissions'] });
      toast({ title: "Station submission approved and added to database" });
    },
    onError: (error) => {
      toast({ 
        title: "Error", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, rejectionReason }: { id: string; rejectionReason: string }) => {
      const response = await fetch(`/api/station-submissions/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionReason })
      });
      if (!response.ok) throw new Error('Failed to reject submission');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/station-submissions'] });
      setIsRejectDialogOpen(false);
      setSelectedSubmission(null);
      toast({ title: "Station submission rejected successfully" });
    },
    onError: (error) => {
      toast({ 
        title: "Error", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/station-submissions/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete submission');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/station-submissions'] });
      toast({ title: "Station submission deleted successfully" });
    },
    onError: (error) => {
      toast({ 
        title: "Error", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const handleRejectSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const rejectionReason = formData.get('rejectionReason') as string;
    
    if (selectedSubmission) {
      rejectMutation.mutate({ id: selectedSubmission._id, rejectionReason });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Pending Review</Badge>;
      case 'approved':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Approved</Badge>;
      case 'rejected':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold tracking-tight">Station Submissions</h1>
        </div>
        <div className="grid gap-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="h-3 bg-gray-200 rounded w-3/4"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const submissions = data?.submissions || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Station Submissions</h1>
          <p className="text-muted-foreground">
            Review and approve user-submitted radio stations
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        
        <Badge variant="secondary" className="ml-auto">
          {submissions.length} {submissions.length === 1 ? 'submission' : 'submissions'}
        </Badge>
      </div>

      <div className="grid gap-4">
        {submissions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No station submissions found.</p>
            </CardContent>
          </Card>
        ) : (
          submissions.map((submission: any) => (
            <Card key={submission._id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    {submission.logo && (
                      <img 
                        src={submission.logo} 
                        alt={`${submission.name} logo`}
                        className="w-12 h-12 rounded-md object-cover border"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    <div>
                      <CardTitle className="text-lg">{submission.name}</CardTitle>
                      <CardDescription className="flex items-center gap-2 mt-1">
                        <ExternalLink className="w-4 h-4" />
                        <a 
                          href={submission.stream_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="hover:underline"
                        >
                          {submission.stream_url}
                        </a>
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(submission.status)}
                    {submission.status === 'pending' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => approveMutation.mutate(submission._id)}
                          disabled={approveMutation.isPending}
                          className="text-green-600 border-green-300 hover:bg-green-50"
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedSubmission(submission);
                            setIsRejectDialogOpen(true);
                          }}
                          className="text-red-600 border-red-300 hover:bg-red-50"
                        >
                          <X className="w-4 h-4 mr-1" />
                          Reject
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteMutation.mutate(submission._id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  {submission.website && (
                    <div>
                      <dt className="font-medium text-muted-foreground flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        Website
                      </dt>
                      <dd>
                        <a 
                          href={submission.website} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {submission.website}
                        </a>
                      </dd>
                    </div>
                  )}
                  
                  {submission.country && (
                    <div>
                      <dt className="font-medium text-muted-foreground">Country</dt>
                      <dd>{submission.country}</dd>
                    </div>
                  )}
                  
                  {submission.state && (
                    <div>
                      <dt className="font-medium text-muted-foreground">State</dt>
                      <dd>{submission.state}</dd>
                    </div>
                  )}
                  
                  {submission.genre && (
                    <div>
                      <dt className="font-medium text-muted-foreground flex items-center gap-1">
                        <Music className="w-3 h-3" />
                        Genre
                      </dt>
                      <dd>{submission.genre}</dd>
                    </div>
                  )}
                  
                  <div>
                    <dt className="font-medium text-muted-foreground">Submitted</dt>
                    <dd className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {format(new Date(submission.createdAt), "MMM d, yyyy")}
                    </dd>
                  </div>
                </div>

                {submission.description && (
                  <div>
                    <dt className="font-medium text-muted-foreground">Description</dt>
                    <dd className="mt-1 text-sm">{submission.description}</dd>
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="w-4 h-4" />
                  <span>
                    Submitted by: {submission.submittedBy || 'Anonymous'}
                    {submission.email && (
                      <span className="ml-1">({submission.email})</span>
                    )}
                  </span>
                </div>

                {submission.rejectionReason && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                    <dt className="font-medium text-sm text-red-800">Rejection Reason</dt>
                    <dd className="mt-1 text-sm text-red-700">{submission.rejectionReason}</dd>
                  </div>
                )}

                {submission.processedAt && (
                  <div className="text-xs text-muted-foreground">
                    Processed on {format(new Date(submission.processedAt), "MMM d, yyyy 'at' h:mm a")}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Reject Dialog */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleRejectSubmit}>
            <DialogHeader>
              <DialogTitle>Reject Station Submission</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting this station submission.
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="rejectionReason" className="text-right">Rejection Reason</Label>
                <Textarea
                  id="rejectionReason"
                  name="rejectionReason"
                  className="col-span-3"
                  placeholder="Reason for rejection..."
                  required
                />
              </div>
            </div>
            
            <DialogFooter>
              <Button type="submit" disabled={rejectMutation.isPending} variant="destructive">
                Reject Submission
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}