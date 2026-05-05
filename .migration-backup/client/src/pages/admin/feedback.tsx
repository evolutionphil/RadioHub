import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Mail, MessageSquare, User, Calendar, Clock, CheckCircle, AlertCircle, Eye, Reply } from "lucide-react";
import { format } from "date-fns";
import { queryClient } from "@/lib/queryClient";

interface Feedback {
  _id: string;
  type: 'bug' | 'feature' | 'general';
  subject: string;
  message: string;
  email?: string;
  userId?: string;
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  response?: string;
  createdAt: string;
  updatedAt?: string;
}

const statusColors = {
  open: 'bg-red-100 text-red-800',
  'in-progress': 'bg-yellow-100 text-yellow-800',
  resolved: 'bg-green-100 text-green-800',
  closed: 'bg-gray-100 text-gray-800',
};

const typeColors = {
  bug: 'bg-red-100 text-red-800',
  feature: 'bg-blue-100 text-blue-800',
  general: 'bg-gray-100 text-gray-800',
};

export default function AdminFeedback() {
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(null);
  const [response, setResponse] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const { toast } = useToast();

  const { data: feedbackData, isLoading } = useQuery({
    queryKey: ['/api/admin/feedback', statusFilter, typeFilter],
    queryFn: () => fetch(`/api/admin/feedback?status=${statusFilter}&type=${typeFilter}`).then(res => res.json()),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, response }: { id: string; status: string; response?: string }) => {
      const res = await fetch(`/api/admin/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, response }),
      });
      if (!res.ok) throw new Error('Failed to update feedback');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Feedback updated successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/feedback'] });
      setSelectedFeedback(null);
      setResponse('');
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update feedback", variant: "destructive" });
    },
  });

  const deleteFeedbackMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/feedback/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete feedback');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Feedback deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/feedback'] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete feedback", variant: "destructive" });
    },
  });

  const handleStatusUpdate = (status: string) => {
    if (!selectedFeedback) return;
    updateStatusMutation.mutate({
      id: selectedFeedback._id,
      status,
      response: response.trim() || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  const feedbackList = feedbackData?.feedback || [];
  const stats = feedbackData?.stats || {
    total: 0,
    open: 0,
    inProgress: 0,
    resolved: 0,
    closed: 0,
    byType: { bug: 0, feature: 0, general: 0 }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feedback Management</h1>
          <p className="text-gray-600">Manage user feedback, bug reports, and feature requests</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <MessageSquare className="w-5 h-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{stats.total}</div>
                <div className="text-sm text-gray-500">Total</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <div>
                <div className="text-2xl font-bold">{stats.open}</div>
                <div className="text-sm text-gray-500">Open</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Clock className="w-5 h-5 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold">{stats.inProgress}</div>
                <div className="text-sm text-gray-500">In Progress</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{stats.resolved}</div>
                <div className="text-sm text-gray-500">Resolved</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 bg-gray-500 rounded-full" />
              <div>
                <div className="text-2xl font-bold">{stats.closed}</div>
                <div className="text-sm text-gray-500">Closed</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in-progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="bug">Bug Reports</SelectItem>
                <SelectItem value="feature">Feature Requests</SelectItem>
                <SelectItem value="general">General Feedback</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Feedback Table */}
      <Card>
        <CardHeader>
          <CardTitle>Feedback List ({feedbackList.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {feedbackList.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No feedback found matching the current filters.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {feedbackList.map((feedback: Feedback) => (
                  <TableRow key={feedback._id}>
                    <TableCell>
                      <div className="font-medium">{feedback.subject}</div>
                      <div className="text-sm text-gray-500 truncate max-w-xs">
                        {feedback.message}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={typeColors[feedback.type]}>
                        {feedback.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[feedback.status]}>
                        {feedback.status.replace('-', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        {feedback.email ? (
                          <>
                            <Mail className="w-4 h-4 text-gray-400" />
                            <span className="text-sm">{feedback.email}</span>
                          </>
                        ) : (
                          <>
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="text-sm">User {feedback.userId?.slice(-6) || 'Anonymous'}</span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2 text-sm text-gray-500">
                        <Calendar className="w-4 h-4" />
                        <span>{format(new Date(feedback.createdAt), 'MMM dd, yyyy')}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => setSelectedFeedback(feedback)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl bg-white border border-gray-200 shadow-lg text-gray-900">
                            <DialogHeader>
                              <DialogTitle className="text-gray-900">Feedback Details</DialogTitle>
                            </DialogHeader>
                            {selectedFeedback && (
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className="text-sm font-medium text-gray-500">Type</label>
                                    <Badge className={typeColors[selectedFeedback.type]}>
                                      {selectedFeedback.type}
                                    </Badge>
                                  </div>
                                  <div>
                                    <label className="text-sm font-medium text-gray-500">Status</label>
                                    <Badge className={statusColors[selectedFeedback.status]}>
                                      {selectedFeedback.status.replace('-', ' ')}
                                    </Badge>
                                  </div>
                                </div>
                                
                                <div>
                                  <label className="text-sm font-medium text-gray-500">Subject</label>
                                  <p className="mt-1 text-gray-900">{selectedFeedback.subject}</p>
                                </div>
                                
                                <div>
                                  <label className="text-sm font-medium text-gray-500">Message</label>
                                  <p className="mt-1 bg-gray-50 p-3 rounded-lg text-gray-900">
                                    {selectedFeedback.message}
                                  </p>
                                </div>
                                
                                {selectedFeedback.response && (
                                  <div>
                                    <label className="text-sm font-medium text-gray-500">Admin Response</label>
                                    <p className="mt-1 bg-blue-50 p-3 rounded-lg text-gray-900">
                                      {selectedFeedback.response}
                                    </p>
                                  </div>
                                )}
                                
                                <div>
                                  <label className="text-sm font-medium text-gray-500">Add Response</label>
                                  <Textarea
                                    value={response}
                                    onChange={(e) => setResponse(e.target.value)}
                                    placeholder="Enter your response..."
                                    className="mt-1"
                                    rows={3}
                                  />
                                </div>
                                
                                <div className="flex space-x-2">
                                  <Button
                                    onClick={() => handleStatusUpdate('in-progress')}
                                    disabled={updateStatusMutation.isPending}
                                    variant="outline"
                                  >
                                    Mark In Progress
                                  </Button>
                                  <Button
                                    onClick={() => handleStatusUpdate('resolved')}
                                    disabled={updateStatusMutation.isPending}
                                    className="bg-green-600 hover:bg-green-700"
                                  >
                                    Mark Resolved
                                  </Button>
                                  <Button
                                    onClick={() => handleStatusUpdate('closed')}
                                    disabled={updateStatusMutation.isPending}
                                    variant="secondary"
                                  >
                                    Close
                                  </Button>
                                </div>
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteFeedbackMutation.mutate(feedback._id)}
                          disabled={deleteFeedbackMutation.isPending}
                          className="text-red-600 hover:text-red-700"
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}