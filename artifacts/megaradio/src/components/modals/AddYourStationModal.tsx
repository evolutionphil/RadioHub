import React, { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';

interface AddYourStationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface StationSubmissionData {
  name: string;
  email: string;
  stream_url: string;
  website: string;
  logo: File | null;
  genre: string;
  country: string;
  state: string;
}

export default function AddYourStationModal({ isOpen, onClose }: AddYourStationModalProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [formKey, setFormKey] = useState(1);
  
  const [submissionFormData, setSubmissionFormData] = useState<StationSubmissionData>({
    name: '',
    email: '',
    stream_url: '',
    website: '',
    logo: null,
    genre: '',
    country: '',
    state: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [failed, setFailed] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const genres = [
    'Pop', 'Rock', 'Jazz', 'Classical', 'Electronic', 'Country', 
    'Hip Hop', 'R&B', 'Folk', 'Blues', 'Reggae', 'Dance', 'Ambient'
  ];

  const countries = [
    'United States', 'United Kingdom', 'Germany', 'France', 'Canada', 
    'Australia', 'Japan', 'Italy', 'Spain', 'Netherlands', 'Other'
  ];

  const handleInputChange = (field: keyof StationSubmissionData, value: string) => {
    setSubmissionFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    setSubmissionFormData(prev => ({
      ...prev,
      logo: files && files.length > 0 ? files[0] : null
    }));
  };

  const closeModal = () => {
    setFormKey(prev => prev + 1);
    setSubmissionFormData({
      name: '',
      email: '',
      stream_url: '',
      website: '',
      logo: null,
      genre: '',
      country: '',
      state: '',
    });
    setErrors({});
    setSuccess(false);
    setFailed(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('name', submissionFormData.name);
      formData.append('email', submissionFormData.email);
      formData.append('stream_url', submissionFormData.stream_url);
      formData.append('website', submissionFormData.website);
      formData.append('genre', submissionFormData.genre);
      formData.append('country', submissionFormData.country);
      formData.append('state', submissionFormData.state);
      
      if (submissionFormData.logo) {
        formData.append('logo', submissionFormData.logo);
      }

      const response = await fetch('/api/station-submissions', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw { errors: errorData.errors, status: response.status };
      }

      setErrors({});
      setSuccess(true);
      setFailed(false);
      setFormKey(prev => prev + 1);
      
      toast({
        title: t('modal_success', 'Success'),
        description: t('station_submission_success', 'Your station submission has been sent successfully!'),
      });
      
      closeModal();
    } catch (error: any) {
      // Station submission error
      setErrors(error.errors || {});
      setFailed(true);
      
      toast({
        title: t('modal_error'),
        description: t('modal_error_try_again'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] h-full">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 h-full bg-black/40 backdrop-blur" 
        onClick={closeModal}
      />
      
      {/* Modal Content */}
      <div className="fixed inset-x-0 top-10 min-h-screen overflow-y-auto">
        <div className="flex min-h-full flex-col items-center justify-center overflow-hidden p-4 text-center modal-content-height">
          <div className="w-full transform overflow-y-scroll rounded-md border border-neutral-700 bg-[#0E0E0E] p-6 text-left align-middle shadow-xl transition-all scrollbar-thin scrollbar-thumb-white/50 md:max-w-lg">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-5">
              <h3 className="flex-1 text-center text-2xl font-medium leading-6 text-[#FF4199]">
                {t('modal_add_station_title')}
              </h3>
              <button
                onClick={closeModal}
                className="text-white/60 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <p className="text-center text-white">
              {t('modal_add_station_description')}
            </p>

            {/* Form */}
            <div className="m-auto w-full pb-5 pt-8 md:w-3/5">
              <form onSubmit={handleSubmit} className="space-y-3" ref={formRef} key={formKey}>
                
                {/* Station Name */}
                <div>
                  <Input
                    type="text"
                    placeholder={t('modal_station_name_placeholder')}
                    value={submissionFormData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    className="w-full bg-neutral-800 border-neutral-600 text-white placeholder:text-neutral-400"
                    required
                  />
                  {errors.name && (
                    <p className="text-red-400 text-sm mt-1">{errors.name}</p>
                  )}
                </div>

                {/* Email */}
                <div>
                  <Input
                    type="email"
                    placeholder={t('modal_email_placeholder')}
                    value={submissionFormData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className="w-full bg-neutral-800 border-neutral-600 text-white placeholder:text-neutral-400"
                    required
                  />
                  {errors.email && (
                    <p className="text-red-400 text-sm mt-1">{errors.email}</p>
                  )}
                </div>

                {/* Stream URL */}
                <div>
                  <Input
                    type="url"
                    placeholder={t('modal_stream_url_placeholder')}
                    value={submissionFormData.stream_url}
                    onChange={(e) => handleInputChange('stream_url', e.target.value)}
                    className="w-full bg-neutral-800 border-neutral-600 text-white placeholder:text-neutral-400"
                    required
                  />
                  {errors.stream_url && (
                    <p className="text-red-400 text-sm mt-1">{errors.stream_url}</p>
                  )}
                </div>

                {/* Genre */}
                <div>
                  <Select value={submissionFormData.genre} onValueChange={(value) => handleInputChange('genre', value)}>
                    <SelectTrigger className="w-full bg-neutral-800 border-neutral-600 text-white data-[placeholder]:text-neutral-400">
                      <SelectValue placeholder={t('modal_select_genre')} />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-800 border-neutral-600 text-white">
                      {genres.map((genre) => (
                        <SelectItem key={genre} value={genre} className="text-white hover:bg-neutral-700 focus:bg-neutral-700 focus:text-white">
                          {genre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.genre && (
                    <p className="text-red-400 text-sm mt-1">{errors.genre}</p>
                  )}
                </div>

                {/* Website */}
                <div>
                  <Input
                    type="url"
                    placeholder={t('modal_website_placeholder')}
                    value={submissionFormData.website}
                    onChange={(e) => handleInputChange('website', e.target.value)}
                    className="w-full bg-neutral-800 border-neutral-600 text-white placeholder:text-neutral-400"
                  />
                  {errors.website && (
                    <p className="text-red-400 text-sm mt-1">{errors.website}</p>
                  )}
                </div>

                {/* Country */}
                <div>
                  <Select value={submissionFormData.country} onValueChange={(value) => handleInputChange('country', value)}>
                    <SelectTrigger className="w-full bg-neutral-800 border-neutral-600 text-white data-[placeholder]:text-neutral-400">
                      <SelectValue placeholder={t('modal_select_country')} />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-800 border-neutral-600 text-white">
                      {countries.map((country) => (
                        <SelectItem key={country} value={country} className="text-white hover:bg-neutral-700 focus:bg-neutral-700 focus:text-white">
                          {country}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.country && (
                    <p className="text-red-400 text-sm mt-1">{errors.country}</p>
                  )}
                </div>

                {/* State */}
                <div>
                  <Input
                    type="text"
                    placeholder={t('modal_state_placeholder')}
                    value={submissionFormData.state}
                    onChange={(e) => handleInputChange('state', e.target.value)}
                    className="w-full bg-neutral-800 border-neutral-600 text-white placeholder:text-neutral-400"
                  />
                  {errors.state && (
                    <p className="text-red-400 text-sm mt-1">{errors.state}</p>
                  )}
                </div>

                {/* Logo Upload */}
                <div>
                  <Label htmlFor="logo-upload" className="text-white text-sm">
                    {t('modal_station_logo')}
                  </Label>
                  <Input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="w-full bg-neutral-800 border-neutral-600 text-white file:bg-neutral-700 file:text-white file:border-0 file:rounded file:px-3 file:py-1 file:mr-3"
                  />
                  {errors.logo && (
                    <p className="text-red-400 text-sm mt-1">{errors.logo}</p>
                  )}
                </div>

                {/* Buttons */}
                <div className="flex gap-2 pt-4 justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closeModal}
                    className="w-full border-neutral-500 text-white hover:bg-neutral-700"
                  >
                    {t('modal_cancel_button')}
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-[#FF4199] hover:bg-[#FF4199]/90 text-white font-semibold"
                  >
                    {isLoading ? t('modal_sending') : t('modal_submit_button')}
                  </Button>
                </div>

                {/* Error Message */}
                {failed && (
                  <p className="text-center font-semibold text-red-600 pt-2">
                    {t('modal_error_try_again')}
                  </p>
                )}

              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}