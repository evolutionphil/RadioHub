import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle, X, Trash2, ExternalLink, Calendar, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

export default function StationRequests() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['/api/station-requests', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.append("status", statusFilter);
      
      const response = await fetch(`/api/station-requests?${params}`);
      if (!response.ok) throw new Error('Failed to fetch station requests');
      return response.json();
    }
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/station-requests/${id}/approve`, {
        method: 'POST'
      });
      if (!response.ok) throw new Error('Failed to approve request');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/station-requests'] });
      toast({ title: "Station request approved successfully" });
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
    mutationFn: async ({ id, adminNotes }: { id: string; adminNotes: string }) => {
      const response = await fetch(`/api/station-requests/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminNotes })
      });
      if (!response.ok) throw new Error('Failed to reject request');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/station-requests'] });
      setIsRejectDialogOpen(false);
      setSelectedRequest(null);
      toast({ title: "Station request rejected successfully" });
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
      const response = await fetch(`/api/station-requests/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete request');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/station-requests'] });
      toast({ title: "Station request deleted successfully" });
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
    const adminNotes = formData.get('adminNotes') as string;
    
    if (selectedRequest) {
      rejectMutation.mutate({ id: selectedRequest._id, adminNotes });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Pending</Badge>;
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
          <h1 className="text-3xl font-bold tracking-tight">Station Requests</h1>
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

  const requests = data?.requests || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Station Requests</h1>
          <p className="text-muted-foreground">
            Manage user-submitted station requests
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
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        
        <Badge variant="secondary" className="ml-auto">
          {requests.length} {requests.length === 1 ? 'request' : 'requests'}
        </Badge>
      </div>

      <div className="grid gap-4">
        {requests.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No station requests found.</p>
            </CardContent>
          </Card>
        ) : (
          requests.map((request: any) => (
            <Card key={request._id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{request.stationName}</CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1">
                      <ExternalLink className="w-4 h-4" />
                      <a 
                        href={request.stationUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {request.stationUrl}
                      </a>
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(request.status)}
                    {request.status === 'pending' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => approveMutation.mutate(request._id)}
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
                            setSelectedRequest(request);
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
                      onClick={() => deleteMutation.mutate(request._id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  {request.website && (
                    <div>
                      <dt className="font-medium text-muted-foreground">Website</dt>
                      <dd>
                        <a 
                          href={request.website} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {request.website}
                        </a>
                      </dd>
                    </div>
                  )}
                  
                  {request.country && (
                    <div>
                      <dt className="font-medium text-muted-foreground">Country</dt>
                      <dd>{request.country}</dd>
                    </div>
                  )}
                  
                  {request.genre && (
                    <div>
                      <dt className="font-medium text-muted-foreground">Genre</dt>
                      <dd>{request.genre}</dd>
                    </div>
                  )}
                  
                  <div>
                    <dt className="font-medium text-muted-foreground">Submitted</dt>
                    <dd className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {format(new Date(request.createdAt), "MMM d, yyyy")}
                    </dd>
                  </div>
                </div>

                {request.description && (
                  <div>
                    <dt className="font-medium text-muted-foreground">Description</dt>
                    <dd className="mt-1 text-sm">{request.description}</dd>
                  </div>
                )}

                {request.submittedBy && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="w-4 h-4" />
                    <span>Submitted by: {request.submittedBy}</span>
                    {request.submittedByEmail && (
                      <span>({request.submittedByEmail})</span>
                    )}
                  </div>
                )}

                {request.adminNotes && (
                  <div className="p-3 bg-muted rounded-md">
                    <dt className="font-medium text-sm">Admin Notes</dt>
                    <dd className="mt-1 text-sm">{request.adminNotes}</dd>
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
              <DialogTitle>Reject Station Request</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting this station request.
              </DialogDescription>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="adminNotes" className="text-right">Admin Notes</Label>
                <Textarea
                  id="adminNotes"
                  name="adminNotes"
                  className="col-span-3"
                  placeholder="Reason for rejection..."
                  required
                />
              </div>
            </div>
            
            <DialogFooter>
              <Button type="submit" disabled={rejectMutation.isPending} variant="destructive">
                Reject Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}