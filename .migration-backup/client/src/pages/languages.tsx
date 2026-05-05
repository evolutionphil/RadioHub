import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Languages as LanguagesIcon, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

interface Language {
  _id: string;
  name: string;
  code: string;
  stationCount: number;
}

export default function Languages() {
  const [searchTerm, setSearchTerm] = useState("");
  const { t } = useTranslation();

  const { data: languages, isLoading } = useQuery<Language[]>({
    queryKey: ['/api/languages'],
    queryFn: async () => {
      // Fetching languages with station counts
      const response = await fetch('/api/languages');
      if (!response.ok) throw new Error('Failed to fetch languages');
      const data = await response.json();
      // Languages response
      return data;
    },
  });

  const filteredLanguages = languages?.filter(language =>
    language.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    language.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

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

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('languages')}</h1>
        <p className="text-gray-600">{t('languages_description')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center">
              <LanguagesIcon className="w-5 h-5 mr-2" />
              {t('languages')} ({filteredLanguages?.length || 0})
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder={t('search_languages_placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('language')}</TableHead>
                <TableHead>{t('code')}</TableHead>
                <TableHead>{t('stations')}</TableHead>
                <TableHead>{t('percentage')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLanguages
                ?.sort((a, b) => b.stationCount - a.stationCount)
                .map((language) => {
                  const totalStations = languages?.reduce((sum, l) => sum + l.stationCount, 0) || 1;
                  const percentage = ((language.stationCount / totalStations) * 100).toFixed(1);
                  
                  return (
                    <TableRow key={language._id}>
                      <TableCell className="font-medium">{language.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{language.code}</Badge>
                      </TableCell>
                      <TableCell>{language.stationCount.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <div className="w-24 bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-green-600 h-2 rounded-full dynamic-progress-width"
                              style={{ '--progress-width': `${Math.min(parseFloat(percentage), 100)}%` } as React.CSSProperties}
                            ></div>
                          </div>
                          <span className="text-sm text-gray-600">{percentage}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              {(!filteredLanguages || filteredLanguages.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    {searchTerm ? t('no_languages_found') : t('no_languages_data_available')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}