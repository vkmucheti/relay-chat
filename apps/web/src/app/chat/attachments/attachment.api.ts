import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { UploadRequest, UploadTicket } from '@relay/shared/browser';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
@Injectable({ providedIn: 'root' })
export class AttachmentApi {
  private readonly http = inject(HttpClient);
  private url(path: string) {
    return environment.api + path;
  }
  upload(input: UploadRequest) {
    return firstValueFrom(this.http.post<UploadTicket>(this.url('/media/presign-upload'), input));
  }
  download(key: string) {
    return firstValueFrom(
      this.http.get<{ url: string }>(this.url('/media/presign-download'), { params: { key } }),
    );
  }
  async put(ticket: UploadTicket, file: File, progress: (value: number) => void) {
    // XHR keeps upload progress independent of HttpClient's fetch backend.
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', ticket.url);
      xhr.timeout = 120_000;
      for (const [key, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) progress(Math.floor((event.loaded / event.total) * 100));
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error('The attachment upload was rejected.'));
      xhr.onerror = () => reject(new Error('Unable to upload the attachment.'));
      xhr.ontimeout = () => reject(new Error('The attachment upload timed out.'));
      xhr.onabort = () => reject(new Error('The attachment upload was canceled.'));
      xhr.send(file);
    });
  }
}
