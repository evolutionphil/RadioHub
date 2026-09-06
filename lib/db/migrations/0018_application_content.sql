CREATE TABLE advertisements (
  id text PRIMARY KEY,title text NOT NULL,image_url text NOT NULL,alt_text text NOT NULL DEFAULT '',
  seo_description text NOT NULL DEFAULT '',url text NOT NULL,
  position text NOT NULL CHECK(position IN ('desktop_sidebar','mobile_bottom','middle_section')),
  is_active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX advertisements_active_position ON advertisements(is_active,position,created_at DESC);
CREATE TABLE footer_social_media (
  id text PRIMARY KEY,platform text NOT NULL CHECK(platform IN ('facebook','instagram','twitter','linkedin','whatsapp','telegram','reddit','pinterest','youtube','tiktok')),
  url text NOT NULL,is_active boolean NOT NULL DEFAULT true,position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX footer_social_media_active_position ON footer_social_media(is_active,position);
CREATE TABLE seo_metadata (
  id text PRIMARY KEY,page_type text NOT NULL CHECK(page_type IN ('homepage','genre_list','genre_detail','station_detail','country_list','country_detail','region','search','static')),
  route_key text NOT NULL,language text NOT NULL,title text NOT NULL,description text NOT NULL,
  og_title text,og_description text,og_image_url text,twitter_title text,twitter_description text,twitter_image_url text,
  canonical_url text,meta_keywords text,no_index boolean NOT NULL DEFAULT false,no_follow boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','ai_generated','template')),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(page_type,route_key,language)
);
CREATE INDEX seo_metadata_status ON seo_metadata(page_type,status,language);
CREATE TABLE app_logs (
  id text PRIMARY KEY,device_id text NOT NULL,app_version text NOT NULL,build_number text NOT NULL DEFAULT '',
  platform text NOT NULL CHECK(platform IN ('ios','android')),logs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(logs)='array'),
  api_key_hash text NOT NULL DEFAULT '',is_car_play_log boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_logs_created ON app_logs(created_at DESC);
CREATE INDEX app_logs_owner_created ON app_logs(api_key_hash,created_at DESC);
CREATE INDEX app_logs_platform_created ON app_logs(platform,created_at DESC);
CREATE INDEX app_logs_device_created ON app_logs(device_id,created_at DESC);
CREATE INDEX app_logs_entries ON app_logs USING gin(logs jsonb_path_ops);
CREATE TABLE feedback (
  id text PRIMARY KEY,type text NOT NULL CHECK(type IN ('bug','feature','general')),subject text NOT NULL,message text NOT NULL,
  email text,user_id text,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in-progress','resolved','closed')),
  response text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz
);
CREATE INDEX feedback_status_created ON feedback(status,created_at DESC);
CREATE INDEX feedback_user_created ON feedback(user_id,created_at DESC);
CREATE INDEX feedback_type_status ON feedback(type,status);
