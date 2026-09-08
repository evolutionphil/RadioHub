import { expect,it } from 'vitest';
import { notificationTarget } from '../src/lib/notification-target';
import { translateUrl } from '@workspace/seo-shared/url-translations';

for (const language of ['en','de','fr','es','it','pt','tr','ru','pl','ar','zh','ja','hi','he']) {
  it(`${language}: header/inbox targets preserve locale and native sender IDs`,()=>{
    const id='aaaaaaaaaaaaaaaaaaaaaaaa';
    expect(notificationTarget({type:'new_message',fromUserId:id},language)).toBe(`/${language}/profile/messages?partner=${id}`);
    expect(notificationTarget({type:'follow',fromUserId:id},language)).toBe(`/${language}/users/${id}`);
    expect(notificationTarget({type:'unfollow',fromUserId:{_id:id,username:'listener'}},language)).toBe(`/${language}/users/${id}`);
    expect(notificationTarget({type:'favorite_station',data:{stationSlug:'kral-fm',stationId:id}},language)).toBe(`/${language}${translateUrl('/station/kral-fm',language)}`);
  });
}
it('notification payloads cannot inject arbitrary or malformed navigation targets',()=>{
  expect(notificationTarget({type:'new_message',fromUserId:'../admin'},'de')).toBeNull();
  expect(notificationTarget({type:'system',data:{url:'https://evil.example'}},'de')).toBeNull();
});
