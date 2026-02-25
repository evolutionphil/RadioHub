import { useState } from "react";
import RadioHeader from "@/components/layout/radio-header";
import Footer from "@/components/layout/footer";

export default function RequestStation() {
  const [formData, setFormData] = useState({
    stationName: '',
    stationUrl: '',
    genre: '',
    country: '',
    language: '',
    description: '',
    requesterName: '',
    requesterEmail: '',
    requestType: 'add' // 'add' or 'request'
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle form submission here
    // Station request submitted
    // Removed alert popup - success message is already shown on the page
    setFormData({
      stationName: '',
      stationUrl: '',
      genre: '',
      country: '',
      language: '',
      description: '',
      requesterName: '',
      requesterEmail: '',
      requestType: 'add'
    });
  };

  return (
    <div className="min-h-screen bg-[#0E0E0E]">
      {/* Page Header */}
      <div className="bg-[#0E0E0E] border-b border-[#1D1D1D]">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-3xl lg:text-4xl font-bold text-white">Station Requests</h1>
          <p className="text-gray-400 mt-2">Submit a new radio station to our directory</p>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-12 text-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold mb-4">Add Your Station or Request a Station</h1>
            <p className="text-xl text-gray-400">
              Help us expand our radio station collection
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12">
            {/* Information Section */}
            <div>
              <h2 className="text-2xl font-bold mb-6 text-[#FF4199]">How It Works</h2>
              
              <div className="space-y-6">
                <div className="bg-[#1D1D1D] p-6 rounded-lg">
                  <h3 className="text-xl font-semibold mb-3 flex items-center">
                    <div className="bg-[#FF4199] w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm font-bold">1</div>
                    Submit Your Request
                  </h3>
                  <p className="text-gray-400">
                    Fill out the form with details about the radio station you'd like to add or request.
                  </p>
                </div>

                <div className="bg-[#1D1D1D] p-6 rounded-lg">
                  <h3 className="text-xl font-semibold mb-3 flex items-center">
                    <div className="bg-[#FF4199] w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm font-bold">2</div>
                    Review Process
                  </h3>
                  <p className="text-gray-400">
                    Our team will review your submission to ensure it meets our quality standards and guidelines.
                  </p>
                </div>

                <div className="bg-[#1D1D1D] p-6 rounded-lg">
                  <h3 className="text-xl font-semibold mb-3 flex items-center">
                    <div className="bg-[#FF4199] w-8 h-8 rounded-full flex items-center justify-center mr-3 text-sm font-bold">3</div>
                    Go Live
                  </h3>
                  <p className="text-gray-400">
                    Once approved, the station will be added to our platform and available to all users.
                  </p>
                </div>
              </div>

              <div className="mt-8 p-6 bg-gradient-to-r from-[#FF4199]/20 to-purple-500/20 rounded-lg border border-[#FF4199]/30">
                <h3 className="text-lg font-semibold mb-3">Requirements</h3>
                <ul className="space-y-2 text-gray-300">
                  <li>• Station must have a valid streaming URL</li>
                  <li>• Content must be legal and appropriate</li>
                  <li>• Station should have consistent streaming</li>
                  <li>• No explicit adult content</li>
                  <li>• Must respect copyright laws</li>
                </ul>
              </div>
            </div>

            {/* Request Form */}
            <div>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Request Type */}
                <div>
                  <label className="block text-sm font-medium mb-3">Request Type</label>
                  <div className="flex gap-4">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="requestType"
                        value="add"
                        checked={formData.requestType === 'add'}
                        onChange={(e) => setFormData(prev => ({ ...prev, requestType: e.target.value }))}
                        className="mr-2 accent-[#FF4199]"
                      />
                      Add My Station
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="requestType"
                        value="request"
                        checked={formData.requestType === 'request'}
                        onChange={(e) => setFormData(prev => ({ ...prev, requestType: e.target.value }))}
                        className="mr-2 accent-[#FF4199]"
                      />
                      Request a Station
                    </label>
                  </div>
                </div>

                {/* Station Details */}
                <div>
                  <label htmlFor="stationName" className="block text-sm font-medium mb-2">Station Name *</label>
                  <input
                    type="text"
                    id="stationName"
                    value={formData.stationName}
                    onChange={(e) => setFormData(prev => ({ ...prev, stationName: e.target.value }))}
                    className="w-full px-4 py-3 bg-[#2F2F2F] border border-gray-600 rounded-lg focus:outline-none focus:border-[#FF4199] text-white"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="stationUrl" className="block text-sm font-medium mb-2">
                    Station URL {formData.requestType === 'add' ? '*' : '(if known)'}
                  </label>
                  <input
                    type="url"
                    id="stationUrl"
                    value={formData.stationUrl}
                    onChange={(e) => setFormData(prev => ({ ...prev, stationUrl: e.target.value }))}
                    className="w-full px-4 py-3 bg-[#2F2F2F] border border-gray-600 rounded-lg focus:outline-none focus:border-[#FF4199] text-white"
                    required={formData.requestType === 'add'}
                    placeholder="https://stream.radio.example.com/live"
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="genre" className="block text-sm font-medium mb-2">Genre</label>
                    <select
                      id="genre"
                      value={formData.genre}
                      onChange={(e) => setFormData(prev => ({ ...prev, genre: e.target.value }))}
                      className="w-full px-4 py-3 bg-[#2F2F2F] border border-gray-600 rounded-lg focus:outline-none focus:border-[#FF4199] text-white"
                    >
                      <option value="">Select Genre</option>
                      <option value="pop">Pop</option>
                      <option value="rock">Rock</option>
                      <option value="jazz">Jazz</option>
                      <option value="classical">Classical</option>
                      <option value="electronic">Electronic</option>
                      <option value="country">Country</option>
                      <option value="hip-hop">Hip Hop</option>
                      <option value="reggae">Reggae</option>
                      <option value="blues">Blues</option>
                      <option value="folk">Folk</option>
                      <option value="news">News</option>
                      <option value="talk">Talk</option>
                      <option value="sports">Sports</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="country" className="block text-sm font-medium mb-2">Country</label>
                    <input
                      type="text"
                      id="country"
                      value={formData.country}
                      onChange={(e) => setFormData(prev => ({ ...prev, country: e.target.value }))}
                      className="w-full px-4 py-3 bg-[#2F2F2F] border border-gray-600 rounded-lg focus:outline-none focus:border-[#FF4199] text-white"
                      placeholder="e.g., United States"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="language" className="block text-sm font-medium mb-2">Language</label>
                  <input
                    type="text"
                    id="language"
                    value={formData.language}
                    onChange={(e) => setFormData(prev => ({ ...prev, language: e.target.value }))}
                    className="w-full px-4 py-3 bg-[#2F2F2F] border border-gray-600 rounded-lg focus:outline-none focus:border-[#FF4199] text-white"
                    placeholder="e.g., English"
                  />
                </div>

                <div>
                  <label htmlFor="description" className="block text-sm font-medium mb-2">Description</label>
                  <textarea
                    id="description"
                    rows={4}
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-4 py-3 bg-[#2F2F2F] border border-gray-600 rounded-lg focus:outline-none focus:border-[#FF4199] text-white resize-none"
                    placeholder="Tell us about this station..."
                  ></textarea>
                </div>

                {/* Requester Information */}
                <div className="border-t border-gray-600 pt-6">
                  <h3 className="text-lg font-semibold mb-4">Your Information</h3>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="requesterName" className="block text-sm font-medium mb-2">Your Name *</label>
                      <input
                        type="text"
                        id="requesterName"
                        value={formData.requesterName}
                        onChange={(e) => setFormData(prev => ({ ...prev, requesterName: e.target.value }))}
                        className="w-full px-4 py-3 bg-[#2F2F2F] border border-gray-600 rounded-lg focus:outline-none focus:border-[#FF4199] text-white"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="requesterEmail" className="block text-sm font-medium mb-2">Your Email *</label>
                      <input
                        type="email"
                        id="requesterEmail"
                        value={formData.requesterEmail}
                        onChange={(e) => setFormData(prev => ({ ...prev, requesterEmail: e.target.value }))}
                        className="w-full px-4 py-3 bg-[#2F2F2F] border border-gray-600 rounded-lg focus:outline-none focus:border-[#FF4199] text-white"
                        required
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-[#FF4199] text-white py-3 px-6 rounded-lg font-semibold hover:bg-[#FF097B] transition-colors"
                >
                  {formData.requestType === 'add' ? 'Submit Station' : 'Request Station'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}