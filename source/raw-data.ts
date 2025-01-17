/*

  Load and process many different file formats to get usable data.

  Gamma MCA: free, open-source web-MCA for gamma spectroscopy
  2022, NuclearPhoenix.- Phoenix1747
  https://nuclearphoenix.xyz

  Do not touch my garbage. All the CSV-related stuff is ugly asf.

*/

import { CoeffObj } from './plot.js';

export interface NPESv1 {
  'schemaVersion': 'NPESv1',
  'deviceData'?: NPESv1DeviceData,
  'sampleInfo'?: NPESv1SampleInfo,
  'resultData': NPESv1ResultData
}

export interface NPESv1Spectrum {
  'numberOfChannels': number,
  'validPulseCount'?: number,
  'measurementTime'?: number,
  'energyCalibration'?: {
    'polynomialOrder': number,
    'coefficients': number[]
  },
  'spectrum': number[]
}

interface NPESv1ResultData {
  'startTime'?: string,
  'endTime'?: string,
  'energySpectrum'?: NPESv1Spectrum,
  'backgroundEnergySpectrum'?: NPESv1Spectrum
}

interface NPESv1DeviceData {
  'deviceName'?: string,
  'softwareName': string
}

interface NPESv1SampleInfo {
  'name'?: string,
  'location'?: string,
  'time'?: string,
  'weight'?: number,
  'volume'?: number,
  'note'?: string
}

interface ImportDataMeta {
  name: string,
  location: string,
  time: string,
  weight?: number,
  volume?: number,
  notes: string,
  deviceName: string,
  startTime: string,
  endTime: string,
  dataMt: number, // Measurement time for the energy spectrum
  backgroundMt: number // Measurement time for the background energy spectrum
}

interface XMLImportData {
  espectrum: number[],
  bgspectrum: number[],
  coeff: CoeffObj,
  meta: ImportDataMeta
}

export class RawData {
  valueIndex: number;
  delimiter: string;
  adcChannels: number;
  fileType: number;
  private tempValIndex: number;
  private schemaURL = '/assets/npes-1.schema.json';
  private jsonSchema: any;

  constructor(valueIndex: number, delimiter = ',') {
    this.valueIndex = valueIndex;
    this.delimiter = delimiter;

    this.adcChannels = 4096; // For OSC
    this.fileType = valueIndex;
    this.tempValIndex = valueIndex;
  }

  private checkLines(value: string): boolean {
    const values = value.split(this.delimiter);

    if (isNaN(parseFloat(values[0].trim()))) return false;
    if (values.length === 1) this.tempValIndex = 0; // Work-Around for files with only one column

    return values.length > this.tempValIndex;
  }

  private parseLines(value: string): number {
    const values = value.split(this.delimiter);
    return parseFloat(values[this.tempValIndex].trim());
  }

  private histConverter(dataArr: number[]): number[] {
    const xArray: number[] = Array(this.adcChannels).fill(0);

    for(const element of dataArr) {
      xArray[element] += 1;
    }
    return xArray;
  }

  csvToArray(data: string): number[] {
    this.tempValIndex = this.valueIndex; // RESET VALUE INDEX

    if (this.fileType === 1) { // HISTOGRAM
      const dataLines = data.split('\n').filter(this.checkLines, this);

      return dataLines.map(this.parseLines, this);
    } else { // CHRONOLOGICAL STREAM
      const dataEvents = data.split(this.delimiter).filter(this.checkLines, this);

      return this.histConverter(dataEvents.map(this.parseLines, this));
    }
  }

  xmlToArray(data: string): XMLImportData {
    const coeff: CoeffObj = {
      c1: 0,
      c2: 0,
      c3: 0
    };
    const meta: ImportDataMeta = {
      name: '',
      location: '',
      time: '',
      notes: '',
      deviceName: '',
      startTime: '',
      endTime: '',
      dataMt: 0,
      backgroundMt: 0
    };

    try {
      const xmlDoc = new DOMParser().parseFromString(data, 'text/xml');
      const especTop = xmlDoc.getElementsByTagName('EnergySpectrum');
      let espectrum = <number[]>[];
      let bgspectrum = <number[]>[];

      if (especTop[0]) {
        const espec = especTop[0].getElementsByTagName('DataPoint');

        espectrum = Array.from(espec).map(item => parseFloat(item.textContent ?? '-1'));

        meta.dataMt = parseFloat(especTop[0].getElementsByTagName('MeasurementTime')[0]?.textContent?.trim() ?? '1');
      }

      const bgspecTop = xmlDoc.getElementsByTagName('BackgroundEnergySpectrum');

      if (bgspecTop[0]) {
        const bgspec = bgspecTop[0].getElementsByTagName('DataPoint');

        bgspectrum = Array.from(bgspec).map(item => parseFloat(item.textContent ?? '-1'));

        meta.backgroundMt = parseFloat(bgspecTop[0].getElementsByTagName('MeasurementTime')[0]?.textContent?.trim() ?? '1');
      }

      const calCoeffsTop = xmlDoc.getElementsByTagName('EnergySpectrum')[0];

      if (calCoeffsTop) {
        const calCoeffs = calCoeffsTop.getElementsByTagName('Coefficient');

        const coeffNumArray = Array.from(calCoeffs).map(item => parseFloat((item.textContent ?? '0')));

        for (const i in coeffNumArray) {
          coeff['c' + (parseInt(i) + 1).toString()] = coeffNumArray[2 - parseInt(i)];
        }
      }

      const rdl = xmlDoc.getElementsByTagName('SampleInfo')[0];

      meta.name = rdl?.getElementsByTagName('Name')[0]?.textContent?.trim() ?? '';
      meta.location = rdl?.getElementsByTagName('Location')[0]?.textContent?.trim() ?? '';
      meta.time = rdl?.getElementsByTagName('Time')[0]?.textContent?.trim() ?? '';
      meta.notes = rdl?.getElementsByTagName('Note')[0]?.textContent?.trim() ?? '';

      let val = parseFloat(rdl?.getElementsByTagName('Weight')[0]?.textContent?.trim() ?? '0');
      if (val > 0) meta.weight = val*1000; // Convert from kg to g

      val = parseFloat(rdl?.getElementsByTagName('Volume')[0]?.textContent?.trim() ?? '0'); // Convert from L to ml
      if (val > 0) meta.volume = val*1000;

      meta.deviceName = xmlDoc.getElementsByTagName('DeviceConfigReference')[0]?.getElementsByTagName('Name')[0]?.textContent?.trim() ?? '';

      meta.startTime = xmlDoc.getElementsByTagName('StartTime')[0]?.textContent?.trim() ?? '';
      meta.endTime = xmlDoc.getElementsByTagName('EndTime')[0]?.textContent?.trim() ?? '';

      return {espectrum, bgspectrum, coeff, meta};
    } catch (e) {
      console.error(e);
      return {espectrum: [], bgspectrum: [], coeff, meta};
    }
  }

  async jsonToObject(data: string): Promise<NPESv1 | false> {
    let json: NPESv1;

    try {
      json = JSON.parse(data);
    } catch (e) {
      console.error(e);
      return false;
    }

    try {
      if (!this.jsonSchema) {
        const response = await fetch(this.schemaURL);

        if (response.ok) {
          const schema = await response.json();
          delete schema['$schema']; // Remove, otherwise it will crash because it cannot resolve the schema URI, wow...
          this.jsonSchema = schema;
        } else {
          throw 'Could not load the schema file!';
        }
      }

      /* // OLD METHOD
      const scripts = Array.from(document.querySelectorAll('script')).map(scr => scr.src);
      if (!scripts.includes('/assets/js/external/ZSchema-browser-min.js')) {
        const tag = document.createElement('script');
        tag.src = '/assets/js/external/ZSchema-browser-min.js';
        tag.async = true;
        tag.onload =
        document.getElementsByTagName('head')[0].appendChild(tag);
      }
      */
      // Unfortunately needed for Typescript to not compile the js file :/
      // @ts-expect-error: Unreachable code error
      await import('./external/ZSchema-browser-min.js'); // Import ZSchema only when it's needed

      const validator = new (<any>window).ZSchema();
      validator.validate(json, this.jsonSchema);
      const errors = validator.getLastErrors();

      if (errors) throw errors; // Catch validation errors

      return json;

    } catch(e) {
      console.error(e);
    }

    return false;
  }
}
