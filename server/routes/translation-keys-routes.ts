import type { Express } from "express";
import { TranslationKey, Translation, TranslationLanguage } from "../../shared/mongo-schemas";
import { logger } from "../utils/logger";
import CacheManager from "../cache";

export async function registerTranslationKeyRoutes(app: Express, deps: any) {
  const { requireAdmin } = deps;

  // ADMIN TRANSLATION KEYS API - Manage translation keys
  app.get("/api/admin/translation-keys", requireAdmin, async (req, res) => {
    try {
      // logger.log('🔑 Fetching admin translation keys...');
      
      // Get all translation keys from database
      const translationKeys = await TranslationKey.find({}).lean();
      
      // logger.log(`✅ Found ${translationKeys.length} translation keys`);
      res.json(translationKeys);
    } catch (error) {
      console.error('Error fetching translation keys:', error);
      res.status(500).json({ error: 'Failed to fetch translation keys' });
    }
  });

  // CREATE Translation Key - from admin form
  app.post("/api/admin/translation-keys", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('../services/translation-version');
      const { key, defaultValue, description, context, category, isPlural } = req.body;

      // Validate required fields
      if (!key || !defaultValue) {
        return res.status(400).json({ error: 'Key and default value are required' });
      }

      // Check if key already exists
      const existingKey = await TranslationKey.findOne({ key });
      if (existingKey) {
        return res.status(400).json({ error: 'Translation key already exists' });
      }

      // Create new translation key
      const newKey = await TranslationKey.create({
        key,
        defaultValue,
        description: description || '',
        context: context || '',
        category: category || 'general',
        isPlural: isPlural || false,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      logger.log(`✅ Created translation key: ${key}`);

      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
      } catch (error) {
        const cacheError = error as any;
        logger.log('⚠️ Cache clearing failed (non-critical)');
      }

      // Bump translation version
      await bumpTranslationVersion(`New key added: ${key}`);

      res.status(201).json(newKey);
    } catch (error) {
      console.error('Error creating translation key:', error);
      res.status(500).json({ error: 'Failed to create translation key' });
    }
  });

  // UPDATE Translation Key
  app.put("/api/admin/translation-keys/:id", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('../services/translation-version');
      const { id } = req.params;
      const { key, defaultValue, description, context, category, isPlural } = req.body;

      // Find and update the key
      const updatedKey = await TranslationKey.findByIdAndUpdate(
        id,
        {
          key,
          defaultValue,
          description,
          context,
          category,
          isPlural,
          updatedAt: new Date()
        },
        { new: true }
      );

      if (!updatedKey) {
        return res.status(404).json({ error: 'Translation key not found' });
      }

      logger.log(`✅ Updated translation key: ${key}`);

      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
      } catch (error) {
        const cacheError = error as any;
        logger.log('⚠️ Cache clearing failed (non-critical)');
      }

      // Bump translation version
      await bumpTranslationVersion(`Key updated: ${key}`);

      res.json(updatedKey);
    } catch (error) {
      console.error('Error updating translation key:', error);
      res.status(500).json({ error: 'Failed to update translation key' });
    }
  });

  // DELETE Translation Key
  app.delete("/api/admin/translation-keys/:id", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('../services/translation-version');
      const { id } = req.params;

      // Find and delete the key
      const deletedKey = await TranslationKey.findByIdAndDelete(id);

      if (!deletedKey) {
        return res.status(404).json({ error: 'Translation key not found' });
      }

      // Also delete all translations for this key
      await Translation.deleteMany({ keyId: id });

      logger.log(`✅ Deleted translation key: ${deletedKey.key}`);

      // Clear translation cache
      try {
        await CacheManager.clearByPattern('translations');
      } catch (error) {
        const cacheError = error as any;
        logger.log('⚠️ Cache clearing failed (non-critical)');
      }

      // Bump translation version
      await bumpTranslationVersion(`Key deleted: ${deletedKey.key}`);

      res.json({ success: true, message: 'Translation key deleted' });
    } catch (error) {
      console.error('Error deleting translation key:', error);
      res.status(500).json({ error: 'Failed to delete translation key' });
    }
  });

  // Add FAQ translation keys for SEO content
  app.post("/api/admin/translation-keys/add-faq-keys", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('../services/translation-version');
      logger.log('❓ Adding FAQ translation keys...');
      
      const faqTranslations = [
        // FAQ Section headers
        { key: 'faq_title', defaultValue: 'Everything You Should Know About Radio', description: 'Main FAQ section title', category: 'seo' },
        { key: 'faq_subtitle', defaultValue: 'Frequently asked questions about online radio streaming', description: 'FAQ section subtitle', category: 'seo' },
        
        // FAQ Questions and Answers
        { key: 'faq_what_is_radio', defaultValue: 'What is Radio?', description: 'FAQ question about radio definition', category: 'seo' },
        { key: 'faq_what_is_radio_answer', defaultValue: 'Radio is a revolutionary wireless communication technology that has been broadcasting audio content through electromagnetic waves for over a century. Traditional radio uses two main transmission methods: AM (Amplitude Modulation) and FM (Frequency Modulation) frequencies to deliver music, news, talk shows, sports commentary, and entertainment to millions of listeners worldwide. Modern radio has evolved dramatically beyond traditional broadcasts to include digital broadcasting technologies like DAB+ (Digital Audio Broadcasting), internet radio streaming, and web radio platforms that deliver content globally. Platforms like Mega Radio represent the future of radio broadcasting, allowing you to access live radio content from around the world directly on your devices - smartphones, tablets, computers, and smart speakers - without requiring traditional radio receivers. Whether you prefer AM/FM radio\'s classic simplicity or the unlimited variety of online radio streaming, today\'s radio landscape offers unprecedented choice and convenience for every type of listener.', description: 'FAQ answer about radio definition', category: 'seo' },
        
        { key: 'faq_what_is_internet_radio', defaultValue: 'What is Internet Radio?', description: 'FAQ question about internet radio', category: 'seo' },
        { key: 'faq_what_is_internet_radio_answer', defaultValue: 'Internet radio, also known as web radio or online radio, revolutionizes how we access live radio by streaming audio content directly over the internet instead of traditional AM/FM radio waves. Unlike conventional radio broadcasting that requires physical radio receivers and is limited by geographical signal reach, internet radio streaming breaks all boundaries, letting you instantly access thousands of live radio stations from every corner of the globe. Whether you\'re using smartphones, tablets, computers, smart speakers, or even smart TVs, internet radio platforms like Mega Radio deliver unlimited access to global radio content through simple web browsers or dedicated mobile apps. From local FM stations streaming online to international broadcasting networks, internet radio offers unprecedented variety - tune into live radio from Paris, Tokyo, New York, or any city worldwide. The beauty of online radio lies in its accessibility: no special equipment needed, no geographical limitations, just instant access to 60,000+ radio stations covering every music genre, news format, sports coverage, and talk show imaginable. Internet radio streaming represents the democratization of global broadcasting, making the world\'s radio content available to everyone, anywhere, anytime.', description: 'FAQ answer about internet radio', category: 'seo' },
        
        { key: 'faq_what_is_web_radio', defaultValue: 'What is Web Radio?', description: 'FAQ question about web radio', category: 'seo' },
        { key: 'faq_what_is_web_radio_answer', defaultValue: 'Web radio is essentially synonymous with internet radio - live radio stations that broadcast exclusively online through websites and streaming platforms rather than traditional AM/FM frequencies. Web radio streaming eliminates all geographical and technical limitations that once restricted radio listening, allowing you to access radio broadcasts from every country, language, and genre worldwide with just a few clicks. Whether you want to listen to live radio from London\'s BBC, French music stations from Paris, jazz radio from New Orleans, or pop stations from Tokyo, web radio platforms like Mega Radio make it instantly possible. The term "web radio" emphasizes the browser-based accessibility - simply open your web browser, visit an online radio platform, choose from thousands of live radio stations, and start streaming immediately without downloads, installations, or complicated setup. Web radio includes everything from traditional FM/AM stations that simulcast online to digital-only internet radio stations created specifically for online streaming. This modern approach to radio broadcasting offers superior audio quality, global accessibility, unlimited variety in music and content, and the convenience of listening on any internet-connected device. Web radio represents the future of broadcasting - borderless, diverse, and instantly accessible to everyone.', description: 'FAQ answer about web radio', category: 'seo' },
        
        { key: 'faq_how_to_listen', defaultValue: 'How can I listen to radio?', description: 'FAQ question about how to listen', category: 'seo' },
        { key: 'faq_how_to_listen_answer', defaultValue: 'Listening to radio has never been more accessible, with multiple convenient methods available to suit every lifestyle and preference. Traditional FM/AM radio still works perfectly with physical radio receivers found in homes, cars, and portable devices, offering reliable local broadcasting. However, modern internet radio streaming has revolutionized radio listening - platforms like Mega Radio let you access 60,000+ live radio stations worldwide directly through web browsers on computers, smartphones, or tablets without any downloads or installations. Digital radio technologies like DAB+ (Digital Audio Broadcasting) provide enhanced audio quality and more station choices than traditional radio. Smart speakers from Amazon Alexa, Google Home, and Apple HomePod offer voice-activated radio streaming - simply ask to play any station. Mobile radio apps for iOS and Android devices provide on-the-go access to global internet radio. Modern car entertainment systems with internet connectivity transform your vehicle into a mobile radio streaming hub. The easiest and most versatile method is online radio streaming through platforms like Mega Radio - simply visit the website, browse or search for your favorite live radio station by genre, country, or name, and click play to start streaming instantly. No subscriptions, no downloads, no complications - just pure radio enjoyment across all your devices.', description: 'FAQ answer about how to listen', category: 'seo' },
        
        { key: 'faq_listen_on_phone', defaultValue: 'Can I listen to radio on my phone?', description: 'FAQ question about mobile listening', category: 'seo' },
        { key: 'faq_listen_on_phone_answer', defaultValue: 'Absolutely! Listening to live radio on your smartphone is incredibly easy and offers multiple convenient options. The simplest method is mobile internet radio streaming - just open any web browser on your iPhone or Android device, visit radio streaming platforms like Mega Radio, and instantly access 60,000+ live radio stations without downloading any apps. Many smartphones also include built-in FM radio receivers (especially Android devices), though online radio streaming provides vastly more variety and global access. For dedicated mobile radio listening, download radio apps from the App Store or Google Play Store - these apps offer enhanced features like favorites, playlists, sleep timers, and offline recording. Mobile radio streaming works seamlessly on both WiFi and cellular data connections, so you can enjoy live radio anywhere - during commutes, at the gym, while traveling, or relaxing at home. Modern smartphones deliver excellent audio quality for radio streaming, especially when connected to Bluetooth headphones, car audio systems, or external speakers. The beauty of mobile internet radio is the unlimited choice - unlike traditional FM/AM radio limited by your location, mobile streaming gives you instant access to radio stations from every country and genre imaginable. Whether you love pop radio, classical music, news broadcasting, sports talk, or jazz stations, your smartphone becomes a powerful global radio receiver through internet radio streaming.', description: 'FAQ answer about mobile listening', category: 'seo' },
        
        { key: 'faq_is_radio_free', defaultValue: 'Is internet radio free?', description: 'FAQ question about pricing', category: 'seo' },
        { key: 'faq_is_radio_free_answer', defaultValue: 'Yes, internet radio is completely free to enjoy on Mega Radio! Unlike subscription-based music services that charge monthly fees, our online radio streaming platform provides unlimited access to 60,000+ live radio stations from around the world at absolutely no cost. You don\'t need to register, create accounts, provide payment information, or worry about hidden charges - just visit the website and start streaming live radio instantly. All you need is an internet connection (WiFi or mobile data) to access our comprehensive collection of web radio stations spanning every genre, language, and country. While some individual radio stations may include advertisements (similar to traditional FM/AM radio broadcasting), the streaming service itself remains entirely free. This free access includes premium features like advanced search, genre filtering, country browsing, personalized recommendations, and multi-device streaming across computers, smartphones, and tablets. The no-cost model of internet radio platforms like Mega Radio democratizes access to global broadcasting, ensuring everyone can enjoy live radio from classical music and jazz to pop, rock, news, sports, and talk shows without financial barriers. Experience unlimited online radio streaming, discover stations from every corner of the world, and enjoy live radio broadcasting completely free - that\'s the beauty and accessibility of modern internet radio.', description: 'FAQ answer about pricing', category: 'seo' },
        
        { key: 'faq_listen_on_pc', defaultValue: 'How can I listen to radio on my PC?', description: 'FAQ question about PC listening', category: 'seo' },
        { key: 'faq_listen_on_pc_answer', defaultValue: 'Listening to live radio on your PC or computer is remarkably simple and requires no special software, installations, or technical knowledge. Just open any modern web browser - whether you use Chrome, Firefox, Safari, Microsoft Edge, or Opera - on your Windows PC, Mac, or Linux computer, visit an online radio streaming platform like Mega Radio, browse through our extensive collection of 60,000+ radio stations, and click play to start streaming instantly. No plugins, no downloads, no complicated setup - just direct browser-based radio streaming. PC radio listening offers distinct advantages: larger screens make browsing and discovering stations easier, superior audio quality through quality speakers or headphones, multi-tasking capability to enjoy radio while working, and stable internet connections for uninterrupted streaming. For optimal experience, ensure your browser is updated to the latest version for best audio codec support, use a reliable internet connection (broadband or WiFi) for buffer-free streaming, and consider connecting quality external speakers or headphones for enhanced sound. Internet radio streaming works flawlessly on all operating systems - Windows 10/11, macOS, Chrome OS, and Linux distributions all support browser-based radio streaming. Whether you\'re working from home and want background music, studying and need focus-enhancing classical radio, or simply relaxing with your favorite live radio stations, PC streaming through platforms like Mega Radio delivers the complete online radio experience with maximum convenience and audio quality.', description: 'FAQ answer about PC listening', category: 'seo' },
        
        { key: 'faq_which_stations', defaultValue: 'Which radio stations can I listen to?', description: 'FAQ question about station availability', category: 'seo' },
        { key: 'faq_which_stations_answer', defaultValue: 'Mega Radio provides comprehensive access to over 60,000 live radio stations from 120+ countries worldwide, covering virtually every imaginable genre, format, and broadcasting style. Listen to pop radio stations playing current hits, rock radio from classic to alternative, classical music broadcasts from world-renowned orchestras, smooth jazz radio, contemporary hip-hop channels, country music stations, electronic dance music (EDM) including house and techno, world music celebrating diverse cultures, blues, reggae, folk, and indie radio. Beyond music, access news radio from major networks like BBC, CNN, NPR, and international news services, sports talk radio covering football, basketball, baseball, and global sports, podcasts and talk shows on every topic imaginable, religious broadcasting across all faiths, educational radio including language learning and lectures, and community radio stations celebrating local culture. Our platform includes major commercial networks like iHeartRadio, Clear Channel stations, BBC Radio 1/2/3/4, NPR affiliates, as well as independent radio, college and university radio stations, public broadcasting, and niche stations dedicated to specific genres or communities. Whether you\'re searching for mainstream pop radio, underground electronic music, traditional folk broadcasting, or specialized content like meditation music or children\'s programming, Mega Radio\'s extensive online radio collection connects you to the world\'s best live radio streaming content. Every station is instantly accessible, searchable by genre, country, language, or name, delivering unlimited radio variety.', description: 'FAQ answer about station availability', category: 'seo' },
        
        { key: 'faq_best_station', defaultValue: 'Which radio station is the best?', description: 'FAQ question about best station', category: 'seo' },
        { key: 'faq_best_station_answer', defaultValue: 'The "best" radio station is beautifully subjective and entirely depends on your unique preferences in music, news, entertainment, and content style - what makes Mega Radio exceptional is our advanced discovery tools that help you find YOUR perfect station among 60,000+ options. For pop music lovers, explore trending radio stations playing current chart-toppers from stations like Capital FM, Z100, or Kiss FM. Rock enthusiasts can discover classic rock, alternative, metal, and indie rock stations from around the world. Classical music aficionados will find prestigious broadcasts from BBC Radio 3, WQXR, and European classical stations. Jazz lovers can tune into legendary jazz radio from WBGO, Jazz FM, and international jazz broadcasters. Our platform\'s intelligent features make discovering the best station for YOU effortless: browse trending radio stations to see what\'s popular globally right now, filter by specific genres (electronic, hip-hop, country, world music), narrow by country or language to find culturally relevant content, or leverage our AI-powered personalized recommendations that learn from your listening habits and suggest stations matching your taste. Whether you prefer commercial-free public radio like NPR, music discovery stations introducing new artists, talk radio for intellectual stimulation, sports commentary for game analysis, or ambient music for relaxation, Mega Radio\'s sophisticated search and filtering tools ensure you\'ll discover stations that resonate with your personal preferences. The best station isn\'t universal - it\'s the one that speaks to you, and we make finding it easy.', description: 'FAQ answer about best station', category: 'seo' },
        
        { key: 'faq_no_ads_stations', defaultValue: 'Which radio stations have no advertising?', description: 'FAQ question about ad-free stations', category: 'seo' },
        { key: 'faq_no_ads_stations_answer', defaultValue: 'Many radio stations worldwide operate without commercial advertising, relying instead on public funding, listener donations, or government support to deliver uninterrupted broadcasting. Public broadcasting services lead this category: NPR (National Public Radio) in the USA, BBC Radio networks in the UK, CBC Radio in Canada, ABC Radio in Australia, and equivalent government-funded broadcasters across Europe, Asia, and beyond all minimize or eliminate commercial advertisements. Classical music radio stations traditionally avoid advertising interruptions to preserve the musical experience - explore stations like WQXR New York, BBC Radio 3, France Musique, and classical stations from Germany and Austria. Jazz radio stations, particularly listener-supported ones like WBGO and WKCR, often provide ad-free programming. University and college radio stations operated by educational institutions typically run without commercial breaks, focusing on music discovery and student programming. Community radio stations funded by listener donations frequently minimize advertising. On Mega Radio, discover ad-free listening experiences by filtering our collection by genres like "Classical", "Jazz", "Public Radio", "Educational", or "University Radio". Browse stations by country and look for public broadcasters - they\'re typically marked as national or public radio services. Remember, these advertisement-free stations depend on alternative funding through public taxes, voluntary donations, or institutional support rather than advertising revenue, enabling them to deliver uninterrupted radio streaming. While completely ad-free stations are less common than commercial radio, our extensive platform offers numerous options for listeners seeking uninterrupted online radio experiences.', description: 'FAQ answer about ad-free stations', category: 'seo' },
        
        // About Mega Radio section - SEO Enhanced with Radio Keywords
        { key: 'faq_about_megaradio', defaultValue: 'About Mega Radio', description: 'About section title in FAQ', category: 'seo' },
        { key: 'faq_about_megaradio_text', defaultValue: 'Mega Radio stands as your ultimate destination for discovering and streaming live radio stations from every corner of the world, representing the cutting edge of internet radio streaming technology. As a leading online radio platform, we provide completely free, unlimited access to over 60,000 live radio stations spanning 120+ countries, delivering an unparalleled variety of music, news, sports commentary, talk shows, podcasts, and entertainment in virtually every language and genre imaginable. Our advanced web radio streaming infrastructure ensures crystal-clear audio quality and reliable connectivity, whether you\'re listening to pop radio from New York, classical broadcasts from Vienna, jazz stations from New Orleans, or electronic music from Berlin. The Mega Radio platform features powerful search capabilities that help you instantly find stations by name, comprehensive filtering options to browse by genre and country, AI-powered personalized recommendations that learn your preferences over time, and seamless live radio streaming across all your devices - smartphones, tablets, desktop computers, laptops, smart speakers, and even smart TVs. We\'ve revolutionized the online radio experience by eliminating geographical boundaries, subscription barriers, and technical complications, making global radio broadcasting accessible to everyone with internet access.', description: 'About Mega Radio description paragraph 1', category: 'seo' },
        { key: 'faq_about_megaradio_features', defaultValue: 'Whether you\'re passionate about pop radio hits and current chart-toppers, rock stations from classic to alternative, classical music from prestigious orchestras and opera houses, smooth jazz broadcasts, electronic dance music and EDM channels, hip-hop and rap radio, country music and Americana, world music celebrating diverse cultures, news radio for current events analysis, sports commentary and live game coverage, or engaging talk shows on every topic imaginable, Mega Radio makes discovering and enjoying your perfect live radio station absolutely effortless. Best of all, Mega Radio operates on a completely free model with zero registration requirements, no subscription fees whatsoever, no hidden costs, and no paywalls blocking premium content - we believe radio should be accessible to everyone. Simply visit our website from any device, use our intuitive search function to find any radio station or genre that interests you, and start streaming live radio instantly without downloads, installations, or complicated setup procedures. Experience the limitless world of internet radio streaming with Mega Radio - your comprehensive gateway to global live broadcasting, available anytime you want to listen, anywhere you happen to be, on absolutely any internet-connected device. Tune in to live radio from Tokyo to New York, London to Rio de Janeiro, Paris to Sydney, Mumbai to Toronto - all at your fingertips with Mega Radio\'s revolutionary online radio platform that brings the world\'s broadcasting to you.', description: 'About Mega Radio description paragraph 2', category: 'seo' },
      ];
      
      let createdCount = 0;
      let updatedCount = 0;
      
      for (const translation of faqTranslations) {
        const existingKey = await TranslationKey.findOne({ key: translation.key });
        
        if (existingKey) {
          await TranslationKey.updateOne(
            { key: translation.key },
            { 
              defaultValue: translation.defaultValue,
              description: translation.description,
              category: translation.category,
              updatedAt: new Date()
            }
          );
          updatedCount++;
        } else {
          await TranslationKey.create({
            ...translation,
            createdAt: new Date(),
            updatedAt: new Date()
          });
          createdCount++;
        }
      }
      
      // Bump translation version
      await bumpTranslationVersion('FAQ translation keys added/updated');
      
      res.json({ 
        success: true, 
        message: `FAQ translation keys processed. Created: ${createdCount}, Updated: ${updatedCount}`,
        createdCount,
        updatedCount
      });
    } catch (error) {
      console.error('Error adding FAQ translation keys:', error);
      res.status(500).json({ error: 'Failed to add FAQ translation keys' });
    }
  });

  // Seed missing English auth translations
  app.post("/api/admin/seed-auth-translations", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('../services/translation-version');
      logger.log('🔐 Adding missing English auth translations...');
      
      const authTranslations = [
        // Auth common keys
        { key: 'auth_login_title', defaultValue: 'Welcome Back', en: 'Welcome Back' },
        { key: 'auth_login_subtitle', defaultValue: 'Login to your account to sync your favorites across all devices.', en: 'Login to your account to sync your favorites across all devices.' },
        { key: 'auth_register_title', defaultValue: 'Create Account', en: 'Create Account' },
        { key: 'auth_register_subtitle', defaultValue: 'Join MegaRadio and start your global radio journey today.', en: 'Join MegaRadio and start your global radio journey today.' },
        { key: 'auth_no_account', defaultValue: 'Don\'t have an account?', en: 'Don\'t have an account?' },
        { key: 'auth_have_account', defaultValue: 'Already have an account?', en: 'Already have an account?' },
        { key: 'auth_sign_up', defaultValue: 'Sign Up', en: 'Sign Up' },
        { key: 'auth_sign_in', defaultValue: 'Sign In', en: 'Sign In' },
        { key: 'auth_continue_with', defaultValue: 'Continue with', en: 'Continue with' },
        { key: 'auth_manage_profile', defaultValue: 'Manage Your Profile', en: 'Manage Your Profile' },
        { key: 'auth_enjoy_listening', defaultValue: 'Enjoy', en: 'Enjoy' },
        { key: 'auth_listening', defaultValue: 'Listening', en: 'Listening' },
        { key: 'auth_email_placeholder', defaultValue: 'E-Mail', en: 'E-Mail' },
        { key: 'auth_password_placeholder', defaultValue: 'Password', en: 'Password' },
        { key: 'auth_login_button', defaultValue: 'Einloggen', en: 'Login' },
        { key: 'auth_forgot_password', defaultValue: 'Passwort vergessen', en: 'Forgot Password?' },
        
        // Additional auth keys from other components
        { key: 'login', defaultValue: 'Login', en: 'Login' },
        { key: 'login_manage_profile', defaultValue: 'Manage your profile', en: 'Manage your profile' },
        { key: 'login_enjoy_listen', defaultValue: 'Enjoy when you listen', en: 'Enjoy when you listen' },
        { key: 'email', defaultValue: 'E-Mail', en: 'E-Mail' },
        { key: 'password', defaultValue: 'Password', en: 'Password' },
        { key: 'logging_in', defaultValue: 'Logging in...', en: 'Logging in...' },
        { key: 'log_in', defaultValue: 'Log in', en: 'Log in' },
        { key: 'forgot_password', defaultValue: 'Forget your password?', en: 'Forget your password?' },
        { key: 'back_to_radio', defaultValue: 'Back to Radio', en: 'Back to Radio' },
        { key: 'auth_create_account', defaultValue: 'Create Account', en: 'Create Account' },
        { key: 'auth_create_account_description', defaultValue: 'Join our radio community and discover amazing stations', en: 'Join our radio community and discover amazing stations' },
        { key: 'auth_continue_with_google', defaultValue: 'Continue with Google', en: 'Continue with Google' },
        { key: 'auth_continue_with_apple', defaultValue: 'Continue with Apple', en: 'Continue with Apple' },
        { key: 'auth_continue_with_facebook', defaultValue: 'Continue with Facebook', en: 'Continue with Facebook' },
        { key: 'auth_continue_with_email', defaultValue: 'Or continue with email', en: 'Or continue with email' },
        { key: 'auth_full_name_label', defaultValue: 'Full Name', en: 'Full Name' },
        { key: 'auth_username_label', defaultValue: 'Username', en: 'Username' },
        { key: 'auth_choose_unique_username', defaultValue: 'Choose a unique username', en: 'Choose a unique username' },
        { key: 'auth_email_label', defaultValue: 'Email Address', en: 'Email Address' },
        { key: 'auth_enter_email', defaultValue: 'Enter your email address', en: 'Enter your email address' },
        { key: 'auth_password_label', defaultValue: 'Password', en: 'Password' },
        { key: 'auth_enter_password', defaultValue: 'Create a strong password', en: 'Create a strong password' },
        
        // Modal auth keys
        { key: 'auth_email_required', defaultValue: 'Email is required', en: 'Email is required' },
        { key: 'auth_password_required', defaultValue: 'Password is required', en: 'Password is required' },
        { key: 'auth_invalid_credentials', defaultValue: 'Invalid email or password', en: 'Invalid email or password' },
        { key: 'auth_network_error', defaultValue: 'Network error. Please try again.', en: 'Network error. Please try again.' }
      ];
      
      logger.log(`📝 Processing ${authTranslations.length} auth translation keys...`);
      
      for (const item of authTranslations) {
        // Create or update the translation key
        const translationKey = await TranslationKey.findOneAndUpdate(
          { key: item.key },
          {
            key: item.key,
            defaultValue: item.defaultValue,
            category: 'auth',
            createdAt: new Date(),
            updatedAt: new Date()
          },
          { upsert: true, new: true }
        );

        // Create or update the English translation
        await Translation.findOneAndUpdate(
          { keyId: translationKey._id, language: 'en' },
          {
            keyId: translationKey._id,
            language: 'en',
            value: item.en,
            isCompleted: true,
            lastModified: new Date(),
            createdAt: new Date()
          },
          { upsert: true, new: true }
        );

        logger.log(`✅ Added English translation for: ${item.key} = "${item.en}"`);
      }
      
      // Clear English translation cache to ensure fresh data is served
      try {
        await CacheManager.clearByPattern('translations');
        logger.log('🔄 Cleared English translations cache');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical):', cacheError.message);
      }
      
      logger.log('🎉 Successfully added all missing English auth translations!');
      
      // Bump translation version
      await bumpTranslationVersion('English auth translations added');
      
      res.json({ 
        success: true,
        message: `Added ${authTranslations.length} English auth translations`, 
        count: authTranslations.length 
      });
    } catch (error) {
      console.error('❌ Error adding English auth translations:', error);
      res.status(500).json({ error: 'Failed to add English auth translations' });
    }
  });

  // Seed Turkish genre translations
  app.post("/api/admin/seed-turkish-genres", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('../services/translation-version');
      // Turkish translations for all genre descriptions
      const turkishTranslations = {
        'genre_description_rock': 'Rock müziğinin gücü ve enerjisini efsanevi klasiklerden modern hitlere kadar yaşayın. Gitar odaklı marşlar, güçlü vokaller und zamansız rock şarkıları içeren radyo istasyonları dinleyin.',
        'genre_description_music': 'Tüm türlerden und dönemlerden inanılmaz çeşitlilikte müziği keşfedin. Klasik şaheserlerden son hitlere, dünya müziğinden underground seslere kadar her şeyi bulun.',
        'genre_description_classical': 'Klasik müziğin zamansız güzelliğini keşfedin. Tarihin en büyük bestecilerinin orkestra şaheserlerini, oda müziğini und klasik bestelerini dinleyin.',
        'genre_description_news': 'Dünyadan en son haberler und güncel olaylarla bilgili kalın. Haber radyo istasyonlarımız siyaset, iş dünyası, spor und son dakika haberlerinin kapsamlı coverage\'ını sağlar.',
        'genre_description_hits': 'Geçmişten und günümüzden en büyük hitleri dinleyin. Hit radyo istasyonlarımız radyo dalgalarına und streaming listelerine hakim olan en popüler şarkıları çalar.',
        'genre_description_jazz': 'Jazz\'ın sofistike seslerine kendinizi kaptırın. Smooth jazz\'dan bebop\'a kadar, efsanevi und çağdaş jazz ustalarının en iyi müziklerini keşfedin.',
        'genre_description_entretenimiento': 'En iyi eğlence programlarının tadını çıkarın. Müzik, talk show\'lar, komedi und çeşitli içeriklerle gün boyunca eğlenceli kalın.',
        'genre_description_radio': 'Radyo dünyasının en iyi içeriklerini keşfedin. Talk show\'lardan müzik programlarına, haber bültenlerinden eğlence içeriklerine kadar.',
        'genre_description_estaci-n': 'İstasyon programlarının zengin içeriklerini keşfedin. Çeşitli müzik türleri und programlarla dolu radyo deneyiminin tadını çıkarın.'
      };

      let addedCount = 0;
      let updatedCount = 0;

      for (const [keyName, turkishValue] of Object.entries(turkishTranslations)) {
        // Find the translation key
        const translationKey = await TranslationKey.findOne({ key: keyName });
        if (!translationKey) {
          logger.log(`⚠️  Translation key not found: ${keyName}`);
          continue;
        }

        // Check if Turkish translation exists
        const existingTranslation = await Translation.findOne({
          keyId: translationKey._id,
          language: 'tr'
        });

        if (existingTranslation) {
          // Update existing
          await Translation.findOneAndUpdate(
            { keyId: translationKey._id, language: 'tr' },
            { 
              value: turkishValue,
              isCompleted: true,
              lastModified: new Date()
            }
          );
          updatedCount++;
          logger.log(`📝 Updated Turkish translation for: ${keyName}`);
        } else {
          // Create new
          await new Translation({
            keyId: translationKey._id,
            language: 'tr',
            value: turkishValue,
            isCompleted: true,
            lastModified: new Date(),
            createdAt: new Date()
          }).save();
          addedCount++;
          logger.log(`✅ Added Turkish translation for: ${keyName}`);
        }
      }

      // Clear Turkish translation cache
      const cacheKey = `translations:tr`;
      await CacheManager.del(cacheKey);
      logger.log('🔄 Cleared Turkish translations cache');

      // Bump translation version
      await bumpTranslationVersion('Turkish genre translations seeded');

      res.json({ 
        success: true, 
        added: addedCount,
        updated: updatedCount,
        total: addedCount + updatedCount,
        message: `Turkish genre translations seeded successfully. Added: ${addedCount}, Updated: ${updatedCount}`
      });

    } catch (error) {
      console.error('Error seeding Turkish genre translations:', error);
      res.status(500).json({ error: 'Failed to seed Turkish genre translations' });
    }
  });

  // Get all translations for admin filtering
  app.get("/api/admin/all-translations", requireAdmin, async (req, res) => {
    try {
      const allTranslations = await Translation.find({}).lean();
      res.json(allTranslations);
    } catch (error) {
      console.error('Error fetching all translations:', error);
      res.status(500).json({ error: 'Failed to fetch all translations' });
    }
  });

  // Bulk upsert translations for admin
  app.post("/api/admin/translations/bulk-upsert", requireAdmin, async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('../services/translation-version');
      const { translations } = req.body;
      
      if (!translations || !Array.isArray(translations)) {
        return res.status(400).json({ error: 'Invalid translations data' });
      }
      
      const results = [];
      for (const translation of translations) {
        const { keyId, language, value, isCompleted } = translation;
        
        const result = await Translation.findOneAndUpdate(
          { keyId, language },
          { 
            value, 
            isCompleted, 
            lastModified: new Date() 
          },
          { 
            upsert: true, 
            new: true 
          }
        );
        
        results.push(result);
      }
      
      // Bump translation version
      await bumpTranslationVersion('Bulk translations upserted');
      
      res.json({ success: true, updated: results.length });
    } catch (error) {
      console.error('Error bulk upserting translations:', error);
      res.status(500).json({ error: 'Failed to bulk upsert translations' });
    }
  });

  // QUICK FIX: Add missing Turkish genre translations (temporary endpoint)
  app.post("/api/fix-turkish-genres", async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('../services/translation-version');
      const turkishTranslations = [
        { key: 'genre_description_rock', value: 'Rock müziğinin gücü und enerjisini efsanevi klasiklerden modern hitlere kadar yaşayın. Gitar odaklı marşlar, güçlü vokaller und zamansız rock şarkıları içeren radyo istasyonları dinleyin.' },
        { key: 'genre_description_music', value: 'Tüm türlerden und dönemlerden inanılmaz çeşitlilikte müziği keşfedin. Klasik şaheserlerden son hitlere, dünya müziğinden underground seslere kadar her şeyi bulun.' },
        { key: 'genre_description_classical', value: 'Klasik müziğin zamansız güzelliğini keşfedin. Tarihin en büyük bestecilerinin orkestra şaheserlerini, oda müziğini und klasik bestelerini dinleyin.' },
        { key: 'genre_description_news', value: 'Dünyadan en son haberler und güncel olaylarla bilgili kalın. Haber radyo istasyonlarımız siyaset, iş dünyası, spor und son dakika haberlerinin kapsamlı coverage\'ını sağlar.' },
        { key: 'genre_description_hits', value: 'Geçmişten und günümüzden en büyük hitleri dinleyin. Hit radyo istasyonlarımız radyo dalgalarına und streaming listelerine hakim olan en popüler şarkıları çalar.' },
        { key: 'genre_description_jazz', value: 'Jazz\'ın sofistike seslerine kendinizi kaptırın. Smooth jazz\'dan bebop\'a kadar, efsanevi und çağdaş jazz ustalarının en iyi müziklerini keşfedin.' },
        { key: 'genre_description_entretenimiento', value: 'En iyi eğlence programlarının tadını çıkarın. Müzik, talk show\'lar, komedi und çeşitli içeriklerle gün boyunca eğlenceli kalın.' },
        { key: 'genre_description_radio', value: 'Radyo dünyasının en iyi içeriklerini keşfedin. Talk show\'lardan müzik programlarına, haber bültenlerinden eğlence içeriklerine kadar.' },
        { key: 'genre_description_estaci-n', value: 'İstasyon programlarının zengin içeriklerini keşfedin. Çeşitli müzik türleri und programlarla dolu radyo deneyiminin tadını çıkarın.' }
      ];

      let addedCount = 0;
      let updatedCount = 0;

      for (const { key, value } of turkishTranslations) {
        const translationKey = await TranslationKey.findOne({ key });
        if (!translationKey) continue;

        const existingTranslation = await Translation.findOne({
          keyId: translationKey._id,
          language: 'tr'
        });

        if (existingTranslation) {
          await Translation.findOneAndUpdate(
            { keyId: translationKey._id, language: 'tr' },
            { value, isCompleted: true, lastModified: new Date() }
          );
          updatedCount++;
        } else {
          await new Translation({
            keyId: translationKey._id,
            language: 'tr',
            value,
            isCompleted: true,
            lastModified: new Date(),
            createdAt: new Date()
          }).save();
          addedCount++;
        }
      }

      // Clear cache (safe approach) - simplified
      logger.log('Skipping cache clear for now - focusing on data fix');

      // Bump translation version
      await bumpTranslationVersion('Turkish genre translations fixed');

      res.json({ 
        success: true, 
        added: addedCount,
        updated: updatedCount,
        message: `Turkish genre translations fixed. Added: ${addedCount}, Updated: ${updatedCount}`
      });

    } catch (error) {
      console.error('Error fixing Turkish genre translations:', error);
      res.status(500).json({ error: 'Failed to fix Turkish genre translations' });
    }
  });

  // SEED: Add missing station page translation keys
  app.post("/api/seed-station-translations", async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('../services/translation-version');
      
      const keysToAdd = [
        { key: 'station_about_station', defaultValue: 'About the station', description: 'Station detail page - About section title' },
        { key: 'station_similar_radios', defaultValue: 'Similar Radios', description: 'Station detail page - Similar radios section title' },
        { key: 'station_more_from_country', defaultValue: 'More from {COUNTRY}', description: 'Station detail page - More from country section. Use {COUNTRY} placeholder' },
        { key: 'nav_login', defaultValue: 'Log in', description: 'Header navigation - Login button text' },
        { key: 'button_search_youtube', defaultValue: 'Search on YouTube', description: 'Station detail page - YouTube search button tooltip' },
        { key: 'button_search_spotify', defaultValue: 'Search on Spotify', description: 'Station detail page - Spotify search button tooltip' },
        { key: 'button_search_deezer', defaultValue: 'Search on Deezer', description: 'Station detail page - Deezer search button tooltip' },
        { key: 'button_share_station', defaultValue: 'Share Station', description: 'Station detail page - Share button tooltip' },
        { key: 'station_media_group_radios', defaultValue: 'Media Group Radios', description: 'Station detail page - Media group radios section title' },
      ];
      
      let createdCount = 0;
      let existsCount = 0;
      
      for (const keyData of keysToAdd) {
        const existing = await TranslationKey.findOne({ key: keyData.key });
        if (existing) {
          existsCount++;
          logger.log(`✓ Key already exists: ${keyData.key}`);
        } else {
          await TranslationKey.create({
            key: keyData.key,
            defaultValue: keyData.defaultValue,
            description: keyData.description,
            category: 'station',
            createdAt: new Date(),
            updatedAt: new Date()
          });
          createdCount++;
          logger.log(`+ Created key: ${keyData.key}`);
        }
        
        // Also add English translation
        const translationKey = await TranslationKey.findOne({ key: keyData.key });
        if (translationKey) {
          await Translation.findOneAndUpdate(
            { keyId: translationKey._id, language: 'en' },
            { 
              keyId: translationKey._id, 
              language: 'en', 
              value: keyData.defaultValue,
              isCompleted: true,
              lastModified: new Date()
            },
            { upsert: true }
          );
        }
      }
      
      // Clear cache
      try {
        await CacheManager.clearByPattern('translations');
      } catch (cacheError) {
        logger.log('⚠️ Cache clearing failed (non-critical)');
      }
      
      await bumpTranslationVersion('Station page translation keys seeded');
      
      res.json({
        success: true,
        created: createdCount,
        existing: existsCount,
        message: `Station page translations seeded. Created: ${createdCount}, Already existed: ${existsCount}. Now run auto-translation from admin panel.`
      });
    } catch (error) {
      console.error('Error seeding station translations:', error);
      res.status(500).json({ error: 'Failed to seed station translations' });
    }
  });

  // QUICK FIX: Fix German translations - remove all English words
  app.post("/api/fix-german-translations", async (req, res) => {
    try {
      const { bumpTranslationVersion } = await import('../services/translation-version');
      const germanTranslations = [
        // ML RECOMMENDATIONS
        { key: 'ml_reason_popular_station', value: 'Beliebter Sender' },
        { key: 'ml_reason_great_for_discovering', value: 'Großartig zum Entdecken neuer Musik' },
        { key: 'ml_why_recommendation', value: 'Warum diese Empfehlung:' },
        { key: 'ml_high_confidence_match', value: 'Hohe Übereinstimmung' },
        { key: 'ml_reason_similar_listeners', value: '{count} ähnliche Hörer' },
        { key: 'ml_reason_avg_listen_time', value: 'Durchschn. Hörzeit: {duration}s' },
        { key: 'ml_reason_popular_in_country', value: 'Beliebt in {country}' },
        { key: 'ml_reason_votes', value: '{count} Stimmen' },
        { key: 'ml_reason_similar_genres', value: 'Ähnliche Genres: {genres}' },
        { key: 'ml_reason_same_country', value: 'Gleiches Land: {country}' },
        { key: 'ml_reason_same_language', value: 'Gleiche Sprache: {language}' },
        { key: 'ml_reason_matches_country_preference', value: 'Entspricht Ihrer Länderpräferenz' },
        // MOODS
        { key: 'mood_energetic', value: 'Energiegeladen' },
        { key: 'mood_relaxed', value: 'Entspannt' },
        { key: 'mood_focused', value: 'Konzentriert' },
        { key: 'mood_nostalgic', value: 'Nostalgisch' },
        { key: 'mood_party', value: 'Feierlaune' },
        { key: 'mood_chill', value: 'Gelassen' },
        { key: 'mood_all', value: 'Alle Stimmungen' },
        { key: 'mood_selector', value: 'Wie fühlen Sie sich?' },
        { key: 'mood_description', value: 'Wählen Sie Ihre Stimmung für bessere Empfehlungen' },
        // FOR YOU PAGE
        { key: 'nav_for_you', value: 'Für Sie' },
        { key: 'for_you_subtitle', value: 'Personalisierte Sender basierend auf Ihrem Geschmack' },
        { key: 'your_music_profile', value: 'Ihr Musikprofil' },
        { key: 'profile_description', value: 'Basierend auf Ihrem Hörverlauf' },
        { key: 'avg_listen_time', value: 'Durchschnittliche Hörzeit' },
        { key: 'stations_played', value: 'Gespielte Sender' },
        { key: 'profile_strength', value: 'Profilstärke' },
        { key: 'total_sessions', value: 'Sitzungen gesamt' },
        { key: 'preferred_genres', value: 'Ihre bevorzugten Genres' },
        { key: 'preferred_countries', value: 'Ihre bevorzugten Länder' },
        { key: 'personalized_for_you', value: 'Personalisiert für Sie' },
        { key: 'trending_now', value: 'Derzeit im Trend' },
        { key: 'discover_new', value: 'Neues entdecken' },
        { key: 'based_on_genres', value: 'Basierend auf Ihren Genres' },
        { key: 'no_recommendations', value: 'Keine Empfehlungen' },
        { key: 'no_recommendations_desc', value: 'Beginnen Sie zu hören, um personalisierte Empfehlungen zu erhalten' },
        { key: 'browse_stations', value: 'Sender durchsuchen' },
        { key: 'homepage_see_all', value: 'Alle anzeigen' },
        { key: 'personalized_description', value: 'Basierend auf Ihren Hörgewohnheiten und Vorlieben' },
        { key: 'trending_description', value: 'Beliebte Sender, über die alle sprechen' },
        // USER MENU
        { key: 'user_menu_signed_in_as', value: 'Angemeldet als' },
        { key: 'user_menu_your_favorites', value: 'Ihre Favoriten' },
        { key: 'user_menu_discover', value: 'Entdecken' },
        { key: 'user_menu_records', value: 'Aufzeichnungen' },
        { key: 'user_menu_profile', value: 'Profil' },
        { key: 'profile_nav_favorites', value: 'Favoriten' },
        { key: 'profile_nav_discover', value: 'Entdecken' },
        { key: 'profile_nav_records', value: 'Aufzeichnungen' },
        { key: 'profile_nav_profile', value: 'Profil' },
        // REGIONS & SEARCH
        { key: 'regions_search_countries', value: 'Länder durchsuchen...' },
        { key: 'regions_search_cities', value: 'Städte durchsuchen...' },
        { key: 'regions_search_stations', value: 'Sender durchsuchen...' },
        { key: 'regions_all_genres', value: 'Alle Genres' },
        { key: 'regions_popular_in_region', value: 'Beliebt in dieser Region' },
        // COMMON
        { key: 'all', value: 'Alle' },
        { key: 'latest', value: 'Neueste' },
        { key: 'recent', value: 'Kürzlich' },
      ];

      let updatedCount = 0;
      for (const item of germanTranslations) {
        const keyDoc = await TranslationKey.findOne({ key: item.key });
        if (keyDoc) {
          await Translation.findOneAndUpdate(
            { keyId: keyDoc._id, language: 'de' },
            { value: item.value, isCompleted: true, lastModified: new Date() },
            { upsert: true }
          );
          updatedCount++;
        }
      }

      await CacheManager.clearByPattern('translations');
      await bumpTranslationVersion('German translations fixed');

      res.json({ success: true, updated: updatedCount });
    } catch (error) {
      console.error('Error fixing German translations:', error);
      res.status(500).json({ error: 'Failed to fix German translations' });
    }
  });
}
