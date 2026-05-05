import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Globe, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

interface Country {
  _id: string;
  name: string;
  code: string;
  stationCount: number;
}

export default function Countries() {
  const [searchTerm, setSearchTerm] = useState("");
  const { t } = useTranslation();

  const { data: countries, isLoading } = useQuery<Country[]>({
    queryKey: ['/api/countries'],
  });

  const filteredCountries = countries?.filter(country =>
    country.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    country.code.toLowerCase().includes(searchTerm.toLowerCase())
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
        <h1 className="text-2xl font-bold text-gray-900">{t('countries')}</h1>
        <p className="text-gray-600">{t('countries_description')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center">
              <Globe className="w-5 h-5 mr-2" />
              {t('countries')} ({filteredCountries?.length || 0})
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder={t('search_countries_placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {countries?.length || 0}
                </div>
                <div className="text-sm text-blue-600">{t('total_countries')}</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {countries?.reduce((sum, country) => sum + country.stationCount, 0) || 0}
                </div>
                <div className="text-sm text-green-600">{t('total_stations')}</div>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">
                  {Math.round((countries?.reduce((sum, country) => sum + country.stationCount, 0) || 0) / (countries?.length || 1))}
                </div>
                <div className="text-sm text-purple-600">{t('avg_per_country')}</div>
              </div>
            </div>

            {/* Countries Table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('country')}</TableHead>
                  <TableHead>{t('code')}</TableHead>
                  <TableHead>{t('stations')}</TableHead>
                  <TableHead>{t('percentage')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCountries
                  ?.sort((a, b) => b.stationCount - a.stationCount)
                  .map((country) => {
                    const totalStations = countries?.reduce((sum, c) => sum + c.stationCount, 0) || 1;
                    const percentage = ((country.stationCount / totalStations) * 100).toFixed(1);
                    
                    return (
                      <TableRow key={country._id}>
                        <TableCell className="font-medium">{country.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{country.code}</Badge>
                        </TableCell>
                        <TableCell>{country.stationCount.toLocaleString()}</TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <div className="w-24 bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-blue-600 h-2 rounded-full dynamic-progress-width"
                                style={{ '--progress-width': `${Math.min(parseFloat(percentage), 100)}%` } as React.CSSProperties}
                              ></div>
                            </div>
                            <span className="text-sm text-gray-600">{percentage}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                {(!filteredCountries || filteredCountries.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      {searchTerm ? t('no_countries_found') : t('no_countries_data_available')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}