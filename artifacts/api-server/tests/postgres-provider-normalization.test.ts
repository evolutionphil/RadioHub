import assert from 'node:assert/strict';
import { describe,it } from 'node:test';
import { RadioBrowserService, type RadioBrowserStation } from '../src/services/radio-browser';

describe('PostgreSQL provider language preservation',()=>{
  it('retains language codes, names and multilingual values without old text-index coercion',()=>{
    const service=new RadioBrowserService();
    for(const language of ['ar','Arabic','ja','Japanese','pl','Ukrainian','Turkish, Arabic','zh-Hant','  Hebrew  ']) {
      const station=service.convertToDbStation({stationuuid:'test-uuid',name:'Test',url:'https://example.invalid',language} as RadioBrowserStation);
      assert.equal(station.language,language.trim().toLowerCase());
    }
    assert.equal(service.convertToDbStation({stationuuid:'test-empty',name:'Test',url:'https://example.invalid',language:''} as RadioBrowserStation).language,'en');
  });
});
